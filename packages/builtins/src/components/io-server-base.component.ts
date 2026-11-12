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
import {
  type IoServerConnectionRow,
  IoServerDashboard,
} from './io-server-base.dashboard.js';
import { IoServerComponentVariables } from './io-server-base.variables.js';

/**
 *
 */
@Component({
  abstract: true,
  className: 'IoServer',
  displayName: 'IO Server',
  description: 'Abstract component for IO operations',
  summary:
    'Abstract base of the components that accept connections from many peers: it defines their data events and communication log.',
  tags: ['io', 'stream'],
})
export class IoServerBaseComponent<
  TEvents extends IoServerBaseComponent.Events = IoServerBaseComponent.Events,
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

  /** Its connections and what each moved: shown where an app includes it */
  @UseDashboard({ title: 'Connections' })
  declare readonly connections: IoServerDashboard;

  @Component.UseVariables()
  declare values: IoServerComponentVariables;

  /** The connections open, by peer: what their rows show */
  protected _connections!: Map<string, IoServerConnectionRow>;
  /* All connections' bytes in the last minute: its activity line */
  protected _perMinute!: Record<'received' | 'sent', PerMinute>;

  protected async _init(): Promise<void> {
    await super._init();
    this._connections = new Map();
    this._perMinute = { received: new PerMinute(), sent: new PerMinute() };
    renewWhileRunning(
      this,
      () => this._renewLines(),
      () => this._clearActivity(),
    );
    /* A component made outside an app factory has no channels nor dashboards */
    this.connections?.count.set(0);
    this.on('data', (data, peer) => {
      this.communicationLog?.write({
        direction: 'in',
        data,
        details: peerOf(peer),
      });
      this._count(peer, 'received', data);
    });
    this.on('transmit', (data, peer) => {
      this.communicationLog?.write({
        direction: 'out',
        data,
        details: peerOf(peer),
      });
      this._count(peer, 'sent', data);
    });
    /* A server of connections tells them; one of requests does not, and
     * its table stays empty */
    this.on('connect', peer => {
      const key = peerOf(peer);
      if (!key) return;
      const row = { peer: key, since: new Date(), received: 0, sent: 0 };
      this._connections.set(key, row);
      this.connections?.connections.upsert(key, row);
      this.connections?.count.set(this._connections.size);
      this._renewActivity();
    });
    this.on('disconnect', peer => {
      const key = peerOf(peer);
      if (!key || !this._connections.delete(key)) return;
      this.connections?.connections.remove(key);
      this.connections?.count.set(this._connections.size);
      this._renewActivity();
    });
  }

  /** Bytes on the chart, and on their connection's row */
  protected _count(
    peer: unknown,
    field: 'received' | 'sent',
    data: Buffer | string,
  ): void {
    const bytes = Buffer.byteLength(data);
    this.connections?.traffic.count(field, bytes);
    this._perMinute[field].add(bytes);
    this._renewActivity();
    const key = peerOf(peer);
    const row = key && this._connections.get(key);
    if (!row) return;
    row[field] += bytes;
    this.connections?.connections.upsert(key, row);
  }

  /** What its glance shows: where it listens; a server gives its own */
  protected get _glanceText(): string | undefined {
    return undefined;
  }

  /** Its glance, as the values may have changed, and its activity */
  protected _renewLines(): void {
    this.setGlance(this._glanceText);
    this._renewActivity();
  }

  /** Its connections, and all their bytes of the last minute, each way */
  protected _renewActivity(): void {
    if (this.stopped) return;
    const n = this._connections.size;
    this.setActivity(
      `${n} ${n === 1 ? 'client' : 'clients'} · ` +
        `↓ ${formatBytes(this._perMinute.received.value)} ` +
        `↑ ${formatBytes(this._perMinute.sent.value)} /min`,
    );
  }

  /** Stopped: no activity, and its counts start again */
  protected _clearActivity(): void {
    this.setActivity(undefined);
    this._perMinute.received.clear();
    this._perMinute.sent.clear();
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
export namespace IoServerBaseComponent {
  export interface Events extends ComponentBase.Events {
    data: [data: Buffer, ...any];
    transmit: [data: Buffer, ...any];
    /** A connection opened and closed: its row on the dashboard */
    connect: [peer: unknown];
    disconnect: [peer: unknown];
  }
  export const Variables = IoServerComponentVariables;
  export type Variables = IoServerComponentVariables;
}
