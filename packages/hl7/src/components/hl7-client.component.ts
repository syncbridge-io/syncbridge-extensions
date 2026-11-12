import { Buffer } from 'node:buffer';
import type { AddressInfo } from 'node:net';
import { peerOf } from '@syncbridge/builtins';
import { Component, ServiceStatus } from '@syncbridge/common';
import colors from 'ansi-colors';
import { HL7Message } from 'hl7v2';
import { Hl7Client, type HL7ProxyOptions } from 'hl7v2-net';
import { noOp } from '../constants.js';
import { HL7ClientVariables } from './hl7-client.variables.js';
import { HL7EndpointComponent } from './hl7-endpoint.component.js';
import { hl7ProtocolOptions } from './hl7-protocol.variables.js';

/**
 * HL7Client component
 */
@Component({
  className: 'HL7Client',
  displayName: 'HL7 Client',
  description: 'HL7 Client component',
  summary:
    'Connects to an HL7 v2 server over MLLP, sends messages and waits for their acknowledgements, with TLS and reconnection.',
  tags: ['hl7', 'client'],
})
export class HL7ClientComponent<
  TEvents extends HL7ClientComponent.Events = HL7ClientComponent.Events,
> extends HL7EndpointComponent<TEvents> {
  protected _address?: any;
  declare client: Hl7Client;

  @Component.UseVariables()
  declare values: HL7ClientVariables;

  protected get _glanceText(): string | undefined {
    return `${this.values.host || '127.0.0.1'}:${this.values.port}`;
  }

  protected async _init(): Promise<void> {
    await super._init();
    this.values.reconnect = this.values.reconnect || {};
    this._createClient();
  }

  get connected(): boolean {
    return !!this.client?.connected;
  }

  protected get _router() {
    return this.client;
  }

  /** A client of the current values, for the next start */
  protected _createClient() {
    const options = {
      host: this.values.host,
      port: this.values.port,
      localAddress: this.values.bindInterface,
      connectTimeout: this.values.connectTimeout,
      responseTimeout: this.values.responseTimeout,
      keepAlive: this.values.keepAlive,
      proxy: this._proxyOptions(),
      ...hl7ProtocolOptions(this.values),
      reconnect: {
        // @ts-ignore
        strategy: 'exponential',
        ...this.values.reconnect,
      },
    };
    this.client =
      this.values.tls_enabled && this.values.tls
        ? Hl7Client.createTlsClient({ ...options, ...this.values.tls })
        : Hl7Client.createClient(options);
    this._attachHandlers();
    this.client.on('connect', () => {
      this._address = {
        address: this.values.host || '127.0.0.1',
        port: this.client.remotePort,
      };
      this._address.toString = function (this: any): string {
        return `${this.address}:${this.port}`;
      }.bind(this._address);
      this.communicationLog?.write({
        direction: 'info',
        event: 'connect',
        message: 'Connected',
        details: peerOf(this._address),
      });
      this.logger?.trace(`Connected to ${colors.blueBright(this._address)}`);
      /* Unhealthy while it was connecting (_start); healthy once connected */
      this.setStatus(ServiceStatus.started);
      this.emit('connect', this._address);
    });
    this.client.on('ready', () => this.emit('ready', this._address));
    this.client.on('close', () => {
      this.communicationLog?.write({
        direction: 'info',
        event: 'disconnect',
        message: 'Disconnected',
        details: peerOf(this._address),
      });
      this.logger?.trace(
        `Disconnected from ${colors.blueBright(this._address)}`,
      );
      this.emit('close', this._address);
    });
    /* A connection lost while running: unhealthy until it reconnects */
    this.client.on('disconnect', (err?: Error) => {
      if (this._stopping) return;
      this.setStatus(
        ServiceStatus.unhealthy,
        err?.message || `Disconnected from ${this._address}`,
      );
    });
    this.client.on('error', error => {
      error = error instanceof AggregateError ? error.errors[0] : error;
      if (error.code === 'ECONNREFUSED')
        error.message = `Connection refused to ${error.address}:${error.port}`;
      this.logger?.error(error);
      this.emit('error', error, this._address);
    });
    this.client.on('message', message => {
      this.logger?.trace(
        `HL7 message (${message.messageType}) received from ${this.client.uri}`,
      );
      this.emit('message', message, this._address);
    });
    this.client.on('send', message => {
      this.logger?.trace(
        `HL7 message (${message.messageType}) sent to ${this.client.uri}`,
      );
      this.emit('send', message, this._address);
    });
    this.client.on('data', data => {
      this.emit('data', data, this._address);
    });
    this.client.on('write', data => {
      this.emit('transmit', data, this._address);
    });
  }

  /** The SOCKS proxy of TcpClient's settings, as hl7v2-net takes it */
  protected _proxyOptions(): HL7ProxyOptions | undefined {
    if (!this.values.proxy_enabled) return undefined;
    const { host, port, proxyType, username, password } = this.values.proxy;
    return {
      host,
      port,
      type: proxyType === 'v4' ? 4 : 5,
      userId: username,
      password,
    };
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this._stopping = false;
    this._createClient();
    this.client.connect().catch(noOp);
    if (!this.client.connected) this.setStatus(ServiceStatus.unhealthy);
  }

  protected async _stop(): Promise<void> {
    this._stopping = true;
    await this.client?.close(30000);
    return super._stop();
  }
}

/**
 * @namespace
 */
export namespace HL7ClientComponent {
  export interface Events extends HL7EndpointComponent.Events {
    connect: [info: AddressInfo];
    ready: [info: AddressInfo];
    close: [info: AddressInfo];
    error: [error: Error, info: AddressInfo];
    message: [message: HL7Message, info: AddressInfo];
    send: [message: HL7Message, info: AddressInfo];
    data: [data: Buffer, info: AddressInfo];
    transmit: [data: Buffer, info: AddressInfo];
  }

  export const Variables = HL7ClientVariables;
  export type Variables = HL7ClientVariables;
}
