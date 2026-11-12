import { Buffer } from 'node:buffer';
import {
  Component,
  ComponentBase,
  LogChannel,
  UseDashboard,
} from '@syncbridge/common';
import {
  formatBytes,
  PerMinute,
  renewWhileRunning,
} from '../utils/activity.js';
import { peerOf } from '../utils/peer-of.js';
import { IoClientDashboard } from './io-client-base.dashboard.js';
import { IoClientComponentVariables } from './io-client-base.variables.js';

/**
 *
 */
@Component({
  abstract: true,
  className: 'IoClient',
  displayName: 'IO Client',
  description: 'Abstract component for IO operations',
  summary:
    'Abstract base of the components that connect to one peer: it defines their data events, write() and communication log.',
  tags: ['io', 'stream'],
})
export class IoClientBaseComponent<
  TEvents extends IoClientBaseComponent.Events = IoClientBaseComponent.Events,
> extends ComponentBase<TEvents> {
  readonly protocol: string = '';

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

  /** Its link and the bytes it moved: shown where an app includes it */
  @UseDashboard({ title: 'Connection' })
  declare readonly connection: IoClientDashboard;

  @Component.UseVariables()
  declare values: IoClientComponentVariables;

  /* Totals since the worker started: a dashboard keeps nothing over a restart */
  protected _received!: number;
  protected _sent!: number;
  /* Bytes in the last minute: the component's activity line */
  protected _receivedPerMinute!: PerMinute;
  protected _sentPerMinute!: PerMinute;

  protected async _init(): Promise<void> {
    await super._init();
    this._received = 0;
    this._sent = 0;
    this._receivedPerMinute = new PerMinute();
    this._sentPerMinute = new PerMinute();
    renewWhileRunning(
      this,
      () => this._renewLines(),
      () => this._clearActivity(),
    );
    /* A component made outside an app factory has no channels nor dashboards */
    this.connection?.link.set('unknown', 'Not connected');
    this.connection?.received.set(0);
    this.connection?.sent.set(0);
    this.on('data', (data, peer) => {
      this.communicationLog?.write({
        direction: 'in',
        data,
        details: peerOf(peer),
      });
      /* A value set many times is sent as its last, once a second */
      const bytes = Buffer.byteLength(data);
      this._received += bytes;
      this.connection?.received.set(this._received);
      this.connection?.traffic.count('received', bytes);
      this._receivedPerMinute.add(bytes);
      this._renewActivity();
    });
    this.on('transmit', (data, peer) => {
      this.communicationLog?.write({
        direction: 'out',
        data,
        details: peerOf(peer),
      });
      const bytes = Buffer.byteLength(data);
      this._sent += bytes;
      this.connection?.sent.set(this._sent);
      this.connection?.traffic.count('sent', bytes);
      this._sentPerMinute.add(bytes);
      this._renewActivity();
    });
    this.on('connect', () => {
      this.communicationLog?.write({
        direction: 'info',
        event: 'connect',
        message: 'Connected',
        details: this.peerAddress,
      });
      this.connection?.link.set(
        'ok',
        this.peerAddress ? `Connected to ${this.peerAddress}` : 'Connected',
      );
    });
    this.on('disconnect', error => {
      const message = error ? `Disconnected: ${error.message}` : 'Disconnected';
      this.communicationLog?.write({
        direction: 'info',
        event: 'disconnect',
        message,
        details: this.peerAddress,
      });
      this.connection?.link.set(error ? 'error' : 'warning', message);
    });
  }

  /**
   * What the component connects to, as its connection's records tell it:
   * `host:port`, a serial port's path, a tunnel's address. A component
   * gives its own; none by default.
   */
  get peerAddress(): string | undefined {
    return undefined;
  }

  /**
   * What its glance shows: what it connects to by default. A component
   * that listens, or says more of its link, gives its own.
   */
  protected get _glanceText(): string | undefined {
    return this.peerAddress;
  }

  /** Its glance, as the values may have changed, and its activity */
  protected _renewLines(): void {
    this.setGlance(this._glanceText);
    this._renewActivity();
  }

  /** The bytes of the last minute, each way */
  protected _renewActivity(): void {
    if (this.stopped) return;
    this.setActivity(
      `↓ ${formatBytes(this._receivedPerMinute.value)} ` +
        `↑ ${formatBytes(this._sentPerMinute.value)} /min`,
    );
  }

  /** Stopped: no activity, and its counts start again */
  protected _clearActivity(): void {
    this.setActivity(undefined);
    this._receivedPerMinute.clear();
    this._sentPerMinute.clear();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  write(data: string | Buffer): void {
    throw new Error(
      `"${this.constructor.name}" component do not support write operations.`,
    );
  }
}

/**
 * @namespace
 */
export namespace IoClientBaseComponent {
  export interface Events extends ComponentBase.Events {
    data: [data: Buffer, ...any];
    transmit: [data: Buffer, ...any];
    /** Written to the communication channel, as are disconnects */
    connect: [];
    disconnect: [error?: Error];
  }
  export const Variables = IoClientComponentVariables;
  export type Variables = IoClientComponentVariables;
}
