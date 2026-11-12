import { Buffer } from 'node:buffer';
import dgram from 'node:dgram';
import { Component, ServiceStatus } from '@syncbridge/common';
import { IoClientBaseComponent } from './io-client-base.component.js';
import { UdpListenerVariables } from './udp-listener.variables.js';

/**
 * UdpListener component
 */
@Component({
  className: 'UdpListener',
  displayName: 'UDP Listener',
  description: 'UDP listener component',
  summary:
    'Listens on a UDP port, broadcast and multicast groups included, and reads the datagrams sent to it.',
  tags: ['udp', 'server', 'connection'],
})
export class UdpListenerComponent<
  TEvents extends UdpListenerComponent.Events = UdpListenerComponent.Events,
> extends IoClientBaseComponent<TEvents> {
  readonly protocol: string = 'udp';
  declare socket: dgram.Socket & { readonly isBroadcastEnabled: boolean };
  @Component.UseVariables()
  declare values: UdpListenerVariables;

  /** Where it listens: it connects to no one */
  protected get _glanceText(): string | undefined {
    return `${this.values.bindInterface || '0.0.0.0'}:${this.values.port}`;
  }

  protected async _init(): Promise<void> {
    await super._init();
    this.on('values-updated', () =>
      this._restart().catch(err =>
        this.setStatus(ServiceStatus.unhealthy, err.message),
      ),
    );
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this.socket = dgram.createSocket('udp4') as any;
    let isBroadcastEnabled = false;
    Object.defineProperty(this.socket, 'isBroadcastEnabled', {
      get(): any {
        return isBroadcastEnabled;
      },
    });
    const oldSetBroadcast = this.socket.setBroadcast;
    this.socket.setBroadcast = (value: boolean) => {
      isBroadcastEnabled = value;
      oldSetBroadcast.call(this.socket, value);
    };
    this.socket.on('error', err => {
      this.logger?.error(err);
      this.emit('error', err);
      this.setStatus(ServiceStatus.unhealthy, err.message);
    });
    this.socket.on('listening', () => {
      const { bindInterface, multicastInterface } = this.values;
      try {
        if (this.values.broadcast) {
          this.logger?.debug(`Broadcast mode enabled`);
          this.socket.setBroadcast(true);
        }
        for (const group of this.values.multicastGroups ?? []) {
          this.logger?.debug(`Joining multicast group ${group}`);
          this.socket.addMembership(group, multicastInterface);
        }
      } catch (err: any) {
        this.socket.emit('error', err);
        return;
      }
      const port = this.socket.address().port;
      this.emit('listening', port);
      /* It connects to no one: listening is its link being up */
      this.connection?.link.set('ok', `Listening on port ${port}`);
      this.logger?.info(
        `UDP socket listening on port ${port}` +
          (bindInterface ? ` interface ${bindInterface}` : ''),
      );
      this.setStatus(ServiceStatus.started);
    });
    this.socket.on('message', (msg, info) => {
      // this.logger.debug(
      //   `Data received from ${colors.cyan(info.address + ':' + info.port)} (${msg.length} bytes)`,
      //   {
      //     host: info.address,
      //     port: info.port,
      //     size: msg.length,
      //   },
      // );
      const info2 = {
        ...info,
        toString() {
          return `${this.address}:${this.port}`;
        },
      };
      this.emit('data', msg, info2);
    });
    this.socket.bind(this.values.port, this.values.bindInterface || '0.0.0.0');
  }

  protected async _stop(): Promise<void> {
    await new Promise<void>(resolve => {
      if (this.socket) this.socket.close(resolve);
      else resolve();
    });
  }

  write(data: string | Buffer, port?: number, host?: string): void {
    port = port || this.values.port;
    if (!host)
      throw new Error(
        'You must provide the "host" argument to send a message over UDP socket',
      );
    this.socket!.send(data, port, host);
    const info2 = {
      address: host,
      port: port,
      size: data.length,
      toString() {
        return `${this.address}:${this.port}`;
      },
    };
    this.emit('transmit', data, info2);
  }
}

/**
 * @namespace
 */
export namespace UdpListenerComponent {
  export interface Events extends IoClientBaseComponent.Events {
    data: [data: Buffer, info: dgram.RemoteInfo];
  }

  export const Variables = UdpListenerVariables;
  export type Variables = UdpListenerVariables;
}
