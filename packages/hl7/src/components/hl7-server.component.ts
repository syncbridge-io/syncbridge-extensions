import { Buffer } from 'node:buffer';
import { type AddressInfo } from 'node:net';
import { peerOf, TcpServerComponent } from '@syncbridge/builtins';
import { Component, SbError, ServiceStatus } from '@syncbridge/common';
import colors from 'ansi-colors';
import { HL7Message } from 'hl7v2';
import { HL7Server, HL7Socket } from 'hl7v2-net';
import { HL7EndpointComponent } from './hl7-endpoint.component.js';
import { hl7ProtocolOptions } from './hl7-protocol.variables.js';
import { HL7ServerVariables } from './hl7-server.variables.js';

/**
 * HL7Server component
 */
@Component({
  className: 'HL7Server',
  displayName: 'HL7 Server',
  description: 'HL7 server component',
  summary:
    'Receives HL7 v2 messages over MLLP and acknowledges them, with TLS, address blocking and middleware for handlers.',
  tags: ['hl7', 'server'],
})
export class HL7ServerComponent<
  TEvents extends HL7ServerComponent.Events = HL7ServerComponent.Events,
> extends HL7EndpointComponent<TEvents> {
  declare server: HL7Server;

  @Component.UseVariables()
  declare values: HL7ServerVariables;

  protected async _init(): Promise<void> {
    await super._init();
    this._createServer();
  }

  /** Whether a device is connected */
  get connected(): boolean {
    return !!this.server?.listening && this.server.connections > 0;
  }

  protected get _router() {
    return this.server;
  }

  protected get _glanceText(): string | undefined {
    return `${this.values.bindInterface || '0.0.0.0'}:${this.values.port}`;
  }

  protected get _activityLead(): string | undefined {
    const n = this.server?.connections ?? 0;
    return `${n} ${n === 1 ? 'client' : 'clients'}`;
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    this._stopping = false;
    this._createServer();
    await this.server.listen(this.values.port, this.values.bindInterface);
    await super._start(abortSignal);
  }

  protected async _stop(): Promise<void> {
    this._stopping = true;
    await this.server.close(30000);
    return super._stop();
  }

  /** A server of the current values, for the next start */
  protected _createServer() {
    const options: HL7Server.Options = {
      ...hl7ProtocolOptions(this.values),
      responseTimeout: this.values.responseTimeout,
    };
    // The socket options, the block lists and, when enabled, the TLS ones
    const listenerOptions = TcpServerComponent.variablesToNodeOptions(
      this.values,
    );
    this.server =
      this.values.tls_enabled && this.values.tls
        ? HL7Server.createTlsServer(listenerOptions, options)
        : HL7Server.createServer(listenerOptions, options);
    this._attachHandlers();
    this.server.on('error', (error: any, socket: HL7Socket) => {
      if (error.code === 'ECONNRESET') return;
      if (socket) {
        error.message =
          error.message +
          ` [${colors.blueBright(socket?.remoteAddress || '')}]`;
      }
      error = new SbError(error);
      if (socket) {
        const info = {
          address: socket.remoteAddress,
          toString: () => socket.remoteAddress,
        };
        this.emit('error', error, info, socket);
      } else {
        if (!this.server.listening)
          this.setStatus(ServiceStatus.unhealthy, error.message);
        this.emit('error', error);
      }
    });
    this.server.on('listening', () => {
      this.logger?.info(
        `HL7 server listening on port ${colors.blueBright(String(this.values.port))}`,
      );
      this.emit('listening');
    });
    this.server.on('close', () => this.emit('close'));
    this.server.on('connection', (socket: HL7Socket) => {
      this.logger?.trace(
        `Connection from: ${colors.blueBright(socket.remoteAddress || '')}`,
      );
      const info = {
        address: socket.remoteAddress,
        port: socket.remotePort,
        toString: () => socket.remoteAddress,
      };
      this.communicationLog?.write({
        direction: 'info',
        event: 'connect',
        message: 'Connected',
        details: peerOf(info),
      });
      this.emit('connection', info, socket);
      this._renewActivity();
    });

    this.server.on('disconnect', (socket: HL7Socket) => {
      this.logger?.trace(
        `Disconnected: ${colors.blueBright(socket.remoteAddress || '')}`,
      );
      const info = {
        address: socket.remoteAddress,
        port: socket.remotePort,
        toString: () => socket.remoteAddress,
      };
      this.communicationLog?.write({
        direction: 'info',
        event: 'disconnect',
        message: 'Disconnected',
        details: peerOf(info),
      });
      this.emit('disconnect', info, socket);
      this._renewActivity();
    });
    this.server.on('message', (message, socket: HL7Socket) => {
      this.logger?.trace(
        `HL7 message (${message.messageType}) received from ${colors.blueBright(socket.remoteAddress || '')}`,
      );
      const info = {
        address: socket.remoteAddress,
        port: socket.remotePort,
        toString: () => socket.remoteAddress,
      };
      this.emit('message', message, info, socket);
    });
    this.server.on('send', (message, socket: HL7Socket) => {
      this.logger?.trace(
        `HL7 message (${message.messageType}) sent to ${colors.blueBright(socket.remoteAddress || '')}`,
      );
      const info = {
        address: socket.remoteAddress,
        port: socket.remotePort,
        toString: () => socket.remoteAddress,
      };
      this.emit('send', message, info, socket);
    });
    this.server.on('data', (data, socket: HL7Socket) => {
      const info = {
        address: socket.remoteAddress,
        port: socket.remotePort,
        toString: () => socket.remoteAddress,
      };
      this.emit('data', data, info, socket);
    });
    this.server.on('write', (data, socket: HL7Socket) => {
      const info = {
        address: socket.remoteAddress,
        port: socket.remotePort,
        toString: () => socket.remoteAddress,
      };
      this.emit('transmit', data, info, socket);
    });
  }
}

/**
 * @namespace
 */
export namespace HL7ServerComponent {
  export interface Events extends HL7EndpointComponent.Events {
    listening: [];
    close: [];
    connection: [info: AddressInfo, socket: HL7Socket];
    disconnect: [info: AddressInfo, socket: HL7Socket];
    error: [error: Error, info?: AddressInfo, socket?: HL7Socket | undefined];
    message: [message: HL7Message, info: AddressInfo, socket: HL7Socket];
    send: [message: HL7Message, info: AddressInfo, socket: HL7Socket];
    data: [data: Buffer, info: AddressInfo, socket: HL7Socket];
    transmit: [data: Buffer, info: AddressInfo, socket: HL7Socket];
  }

  export const Variables = HL7ServerVariables;
  export type Variables = HL7ServerVariables;
  export const TlsVariables: typeof TcpServerComponent.TlsVariables =
    TcpServerComponent.TlsVariables;
  export type TlsVariables = TcpServerComponent.TlsVariables;
}
