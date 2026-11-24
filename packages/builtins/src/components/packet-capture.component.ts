import type { Readable } from 'node:stream';
import {
  Component,
  PacketCaptureError,
  SbError,
  ServiceStatus,
  UseDashboard,
  WorkerPermission,
} from '@syncbridge/common';
import { PcapParser, type PcapRecord } from '../classes/pcap-parser.js';
import { formatCount, PerMinute } from '../utils/activity.js';
import { type Datagram, datagramOf } from '../utils/datagram.js';
import { IoClientBaseComponent } from './io-client-base.component.js';
import { PacketCaptureDashboard } from './packet-capture.dashboard.js';
import { PacketCaptureVariables } from './packet-capture.variables.js';

/* How long before asking again: an admin may approve it meanwhile, or the
 * capture that ended may come back */
const RETRY_MS = 10_000;

/**
 * PacketCapture component
 */
@Component({
  className: 'PacketCapture',
  displayName: 'Packet Capture',
  description: 'Reads the frames of a network interface',
  summary:
    "Reads a network interface's frames, such as a mirror port, as SyncBridge captures them, and tells each frame and UDP datagram.",
  tags: ['capture', 'pcap', 'mirror', 'udp', 'network'],
  permissions: [WorkerPermission.NetworkCapture],
})
export class PacketCaptureComponent<
  TEvents extends PacketCaptureComponent.Events = PacketCaptureComponent.Events,
> extends IoClientBaseComponent<TEvents> {
  readonly protocol: string = 'pcap';

  @Component.UseVariables()
  declare values: PacketCaptureVariables;

  /** Its frames, datagrams and what was cut: shown where an app includes it */
  @UseDashboard({ title: 'Capture' })
  declare readonly capture: PacketCaptureDashboard;

  /** How long before asking again; a test shortens it */
  protected _retryMs = RETRY_MS;
  protected _stream?: Readable;
  protected _retryTimer?: NodeJS.Timeout;
  protected _stopping?: boolean;
  protected _truncated!: number;
  protected _framesPerMinute!: PerMinute;
  protected _datagramsPerMinute!: PerMinute;

  get peerAddress(): string | undefined {
    return this.values.interface || undefined;
  }

  get connected(): boolean {
    return !!this._stream;
  }

  protected async _init(): Promise<void> {
    this._truncated = 0;
    this._framesPerMinute = new PerMinute();
    this._datagramsPerMinute = new PerMinute();
    await super._init();
    this.capture?.truncated.set(0);
    this.capture?.lastFrame.set('unknown', 'None yet');
    this.on('values-updated', () =>
      this._restart().catch(err =>
        this.setStatus(ServiceStatus.unhealthy, err.message),
      ),
    );
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this._stopping = false;
    await this._open();
  }

  protected async _stop(): Promise<void> {
    this._stopping = true;
    clearTimeout(this._retryTimer);
    const stream = this._stream;
    this._stream = undefined;
    stream?.destroy();
    if (stream) this.emit('disconnect');
  }

  /**
   * Asks SyncBridge for the capture. Not yet approved, or ended: unhealthy,
   * and asked again after a while; refused for good (no such interface, a
   * filter that does not compile, an engine that cannot capture): unhealthy
   * until the values change
   */
  protected async _open(): Promise<void> {
    const openCapture = this.app?.packetCapture;
    if (!openCapture) {
      this.setStatus(
        ServiceStatus.unhealthy,
        'This SyncBridge cannot capture packets: it is older than the component',
      );
      return;
    }
    let stream: Readable;
    try {
      stream = await openCapture({
        interface: this.values.interface,
        filter: this.values.filter || undefined,
        promiscuous: this.values.promiscuous ?? true,
        snapLength: this.values.snapLength,
      });
    } catch (err: any) {
      if (this._stopping) return;
      this.setStatus(ServiceStatus.unhealthy, this._refusalText(err));
      this.connection?.link.set('error', this._refusalText(err));
      if (err?.code === PacketCaptureError.NotApproved) this._retry();
      return;
    }
    if (this._stopping) {
      stream.destroy();
      return;
    }
    this._stream = stream;
    this._read(stream);
    this.setStatus(ServiceStatus.started);
    this.emit('connect');
  }

  /** The stream's pcap records, as frames and datagrams */
  protected _read(stream: Readable): void {
    const parser = new PcapParser();
    stream.on('data', (chunk: Buffer) => {
      let records: PcapRecord[];
      try {
        records = parser.push(chunk);
      } catch (err: any) {
        stream.destroy(err);
        return;
      }
      for (const record of records) this._take(record);
    });
    const ended = (err?: Error) => {
      if (this._stream !== stream) return;
      this._stream = undefined;
      if (this._stopping) return;
      const error = err || new Error('The capture ended');
      this.setStatus(ServiceStatus.unhealthy, error.message);
      this.emit('disconnect', error);
      this._retry();
    };
    stream.once('error', ended);
    stream.once('close', () => ended());
  }

  protected _take(record: PcapRecord): void {
    const { time, data, linkType } = record;
    this.emit('data', data, this.values.interface);
    this.emit('frame', { time, data, linkType });
    this._framesPerMinute.add();
    this.capture?.rate.count('frames');
    if (record.originalLength > data.length)
      this.capture?.truncated.set(++this._truncated, { tone: 'warning' });
    const datagram = datagramOf(data, linkType, time);
    if (datagram) {
      this.emit('datagram', datagram);
      this._datagramsPerMinute.add();
      this.capture?.rate.count('datagrams');
      this.capture?.lastFrame.set(
        'ok',
        `${datagram.srcIp}:${datagram.srcPort} → ${datagram.dstIp}:${datagram.dstPort}, ${datagram.payload.length} bytes`,
      );
    } else
      this.capture?.lastFrame.set(
        'ok',
        `${data.length} bytes, link type ${linkType}`,
      );
    this._renewActivity();
  }

  protected _retry(): void {
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      if (!this._stopping) this._open().catch(() => undefined);
    }, this._retryMs);
    this._retryTimer.unref();
  }

  /** Why SyncBridge refused it, as an admin acts on it */
  protected _refusalText(err: SbError | Error): string {
    const where = `${this.values.interface}${this.values.filter ? ` (${this.values.filter})` : ''}`;
    switch ((err as SbError).code) {
      case PacketCaptureError.NotApproved:
        return `Waiting for an admin to approve capturing ${where}`;
      case PacketCaptureError.NotPermitted:
        return 'The worker may not capture packets';
      case PacketCaptureError.NoSuchInterface:
        return `This server has no network interface "${this.values.interface}"`;
      case PacketCaptureError.BadFilter:
        return `The filter does not compile: ${err.message}`;
      default:
        return err.message;
    }
  }

  /** The interface and its filter */
  protected get _glanceText(): string | undefined {
    if (!this.values.interface) return;
    return this.values.filter
      ? `${this.values.interface} · ${this.values.filter}`
      : this.values.interface;
  }

  /** Frames and datagrams, not bytes: what a capture is watched for */
  protected _renewActivity(): void {
    if (this.stopped) return;
    this.setActivity(
      `${formatCount(this._framesPerMinute.value)} frames/min · ` +
        `${formatCount(this._datagramsPerMinute.value)} datagrams/min`,
    );
  }

  protected _clearActivity(): void {
    super._clearActivity();
    this._framesPerMinute.clear();
    this._datagramsPerMinute.clear();
  }
}

/**
 * @namespace
 */
export namespace PacketCaptureComponent {
  export interface Events extends IoClientBaseComponent.Events {
    /** A captured frame: the whole link-layer frame, its tags kept */
    frame: [frame: Frame];
    /** A UDP datagram a frame carried, as UDP Listener tells one */
    datagram: [datagram: Datagram];
  }

  export interface Frame {
    time: Date;
    data: Buffer;
    /** pcap's link type: 1 for Ethernet */
    linkType: number;
  }

  export const Variables = PacketCaptureVariables;
  export type Variables = PacketCaptureVariables;
}
