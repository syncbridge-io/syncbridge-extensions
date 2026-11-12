import { Buffer } from 'node:buffer';
import type { AddressInfo } from 'node:net';
import {
  formatCount,
  peerOf,
  PerMinute,
  renewWhileRunning,
} from '@syncbridge/builtins';
import {
  Component,
  ComponentBase,
  LogChannel,
  ServiceStatus,
  UseDashboard,
} from '@syncbridge/common';
import { HL7Message } from 'hl7v2';
import type { HL7Middleware, HL7ResponseHook, HL7Socket } from 'hl7v2-net';
import { HL7Dashboard } from './hl7-endpoint.dashboard.js';
import type { HL7ProtocolVariables } from './hl7-protocol.variables.js';

/**
 * HL7Endpoint: the abstract base of HL7Client and HL7Server
 */
@Component({
  abstract: true,
  className: 'HL7Endpoint',
  displayName: 'HL7 Endpoint',
  description: 'Abstract component for HL7 v2 over MLLP',
  summary:
    'Abstract base of the HL7 client and server: an app that declares it takes either, and receives messages from both the same way.',
  tags: ['hl7'],
})
export class HL7EndpointComponent<
  TEvents extends HL7EndpointComponent.Events = HL7EndpointComponent.Events,
> extends ComponentBase<TEvents> {
  protected _stopping?: boolean;
  /**
   * Handlers added with use(), kept by the component: the client or server
   * is created again whenever the values change, and each new one gets
   * them all
   */
  protected readonly _middlewares: {
    handler: HL7Middleware;
    priority?: number;
  }[] = [];
  /** beforeResponse() hooks, kept for the same reason */
  protected readonly _responseHooks: HL7ResponseHook[] = [];

  /** What the component receives and transmits */
  @LogChannel({
    name: 'communication',
    title: 'Communication',
    description: 'What the component receives and transmits',
    kind: 'transmit',
    retentionDays: 14,
    /* Off unless turned on: traffic grows the logs fast, and the devices
     * on the other side often keep it themselves */
    enabled: false,
    events: ['connect', 'disconnect', 'read', 'write'],
  })
  declare readonly communicationLog: LogChannel;

  /** Its messages and errors: shown where an app includes it */
  @UseDashboard({ title: 'Messages' })
  declare readonly messages: HL7Dashboard;

  /* Each subclass attaches its own variables class: they extend different
   * TCP variable classes */
  declare values: HL7EndpointComponent.Variables;

  /* Since the worker started: a dashboard keeps nothing over a restart */
  protected _errors!: number;
  protected _received!: Map<string, number>;
  /* The last minute's messages and errors, and the last message that was
   * not an acknowledgment: its activity line */
  protected _perMinute!: Record<'in' | 'out' | 'errors', PerMinute>;
  protected _lastType?: string;

  /** Whether a peer is connected: the server for the client, any device for the server */
  get connected(): boolean {
    return false;
  }

  /** The hl7v2-net client or server handlers go to, once created */
  protected get _router():
    | {
        use(handler: HL7Middleware, priority?: number): void;
        beforeResponse(hook: HL7ResponseHook): void;
      }
    | undefined {
    return undefined;
  }

  protected async _init(): Promise<void> {
    await super._init();
    this._errors = 0;
    this._received = new Map();
    this._perMinute = {
      in: new PerMinute(),
      out: new PerMinute(),
      errors: new PerMinute(),
    };
    renewWhileRunning(
      this,
      () => {
        this.setGlance(this._glanceText);
        this._renewActivity();
      },
      () => {
        this.setActivity(undefined);
        for (const rate of Object.values(this._perMinute)) rate.clear();
        this._lastType = undefined;
      },
    );
    /* A component made outside an app factory has no channels nor dashboards */
    this.messages?.errors.set(0);
    this.on('message', (message, info) => this._show('in', message, info));
    this.on('send', (message, info) => this._show('out', message, info));
    this.on('error', () => {
      this.messages?.errors.set(++this._errors);
      this._perMinute.errors.add();
      this._renewActivity();
    });
    this.on('data', (data, info) => {
      this.communicationLog?.write({
        direction: 'in',
        data,
        details: peerOf(info),
      });
    });
    this.on('transmit', (data, info) => {
      this.communicationLog?.write({
        direction: 'out',
        data,
        details: peerOf(info),
      });
    });
    this.on('values-updated', () =>
      this._restart().catch(err =>
        this.setStatus(ServiceStatus.unhealthy, err.message),
      ),
    );
  }

  /** A message on the dashboard: its rate, its type's bar, its feed row */
  protected _show(
    direction: 'in' | 'out',
    message: HL7Message,
    info?: AddressInfo,
  ): void {
    const type = message.messageType || '?';
    this._perMinute[direction].add();
    if (!type.startsWith('ACK')) this._lastType = type;
    this._renewActivity();
    if (!this.messages) return;
    this.messages.rate.count(direction === 'in' ? 'received' : 'sent');
    if (direction === 'in') {
      const n = (this._received.get(type) || 0) + 1;
      this._received.set(type, n);
      this.messages.types.upsert(type, { value: n });
    }
    this.messages.last.append({
      direction,
      type,
      controlId: String(message.get('MSH-10') ?? ''),
      ack: String(message.get('MSA-1') ?? ''),
      peer: peerOf(info) || '',
    });
  }

  /** What its glance shows: where it connects or listens */
  protected get _glanceText(): string | undefined {
    return undefined;
  }

  /** What comes first on its activity line: a server's connections */
  protected get _activityLead(): string | undefined {
    return undefined;
  }

  /** Messages of the last minute each way, the last one, and errors */
  protected _renewActivity(): void {
    if (this.stopped) return;
    const errors = this._perMinute.errors.value;
    const parts = [
      this._activityLead,
      `↓ ${formatCount(this._perMinute.in.value)} ` +
        `↑ ${formatCount(this._perMinute.out.value)} msg/min`,
      this._lastType && `last ${this._lastType}`,
      errors && `${formatCount(errors)} ${errors === 1 ? 'error' : 'errors'}`,
    ];
    this.setActivity(
      parts.filter(Boolean).join(' · '),
      errors ? 'warning' : undefined,
    );
  }

  /** Gives a newly created client or server the handlers and hooks added so far */
  protected _attachHandlers(): void {
    const router = this._router!;
    for (const m of this._middlewares) router.use(m.handler, m.priority);
    for (const hook of this._responseHooks) router.beforeResponse(hook);
  }

  /**
   * Adds a handler for received messages. It stays when the client or
   * server is created again for new values.
   */
  use(handler: HL7Middleware, priority?: number): void {
    this._middlewares.push({ handler, priority });
    this._router?.use(handler, priority);
  }

  /**
   * Adds a hook that sees every answer to a received message before it is
   * sent, and may change it, replace it (return another message) or drop
   * it (return null) - for a device that expects other acknowledgments
   * than the standard ones. It stays when the client or server is created
   * again for new values. See hl7v2-net's beforeResponse.
   */
  beforeResponse(hook: HL7ResponseHook): void {
    this._responseHooks.push(hook);
    this._router?.beforeResponse(hook);
  }
}

/**
 * @namespace
 */
export namespace HL7EndpointComponent {
  /** The events both emit; the server adds the peer's socket */
  export interface Events extends ComponentBase.Events {
    error: [error: Error, info?: AddressInfo, socket?: HL7Socket];
    message: [message: HL7Message, info: AddressInfo, socket?: HL7Socket];
    send: [message: HL7Message, info: AddressInfo, socket?: HL7Socket];
    data: [data: Buffer, info: AddressInfo, socket?: HL7Socket];
    transmit: [data: Buffer, info: AddressInfo, socket?: HL7Socket];
  }

  /** The values both have */
  export interface Variables extends HL7ProtocolVariables {
    responseTimeout: number;
    tls_enabled?: boolean;
  }
}
