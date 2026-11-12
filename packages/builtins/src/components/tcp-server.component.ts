import net from 'node:net';
import tls from 'node:tls';
import { Component } from '@syncbridge/common';
import { peerOf } from '../utils/peer-of.js';
import { IoServerBaseComponent } from './io-server-base.component.js';
import {
  TcpServerTlsVariables,
  TcpServerVariables,
  tcpServerVariablesToNodeOptions,
} from './tcp-server.variables.js';

/**
 * TcpServer component
 */
@Component({
  className: 'TcpServer',
  displayName: 'TCP Server',
  description: 'TCP server component',
  summary:
    'Accepts TCP connections, with optional TLS and block lists, and reads and writes their bytes.',
  tags: ['tcp', 'server', 'socket'],
})
export class TcpServerComponent<
  TEvents extends TcpServerComponent.Events = TcpServerComponent.Events,
> extends IoServerBaseComponent<TEvents> {
  declare server: net.Server;
  protected _sockets!: Set<net.Socket>;

  @Component.UseVariables()
  declare values: TcpServerVariables;

  protected get _glanceText(): string | undefined {
    return `${this.values.bindInterface || '0.0.0.0'}:${this.values.port}`;
  }

  protected async _init(): Promise<void> {
    await super._init();
    this._createServer();
  }

  /** The server, made once: apps add their handlers to it */
  protected _createServer() {
    this._sockets = new Set();
    const serverOptions = TcpServerComponent.variablesToNodeOptions(
      this.values,
    );
    this.server = this.values.tls_enabled
      ? tls.createServer(serverOptions)
      : net.createServer(serverOptions);
    /* A TLS connection's traffic as it is read and written, not encrypted */
    this.server.on(
      this.values.tls_enabled ? 'secureConnection' : 'connection',
      (socket: net.Socket) => this._watchConnection(socket),
    );
  }

  /**
   * Tells a connection's traffic, for the communication channel: what the
   * code using the socket reads (data) and writes (transmit). It changes
   * nothing of how the socket is read: no listener is added, so a socket
   * read later, or paused, loses nothing.
   */
  protected _watchConnection(socket: net.Socket) {
    const component = this;
    const peer = { address: socket.remoteAddress, port: socket.remotePort };
    const note = (event: string, message: string) =>
      this.communicationLog?.write({
        direction: 'info',
        event,
        message,
        details: peerOf(peer),
      });
    note('connect', 'Connected');
    this.emit('connect', peer);
    this._sockets.add(socket);
    socket.once('close', () => {
      this._sockets.delete(socket);
      note('disconnect', 'Disconnected');
      this.emit('disconnect', peer);
    });
    const emit = socket.emit;
    socket.emit = function (this: net.Socket, event: string | symbol, ...args) {
      if (event === 'data') component.emit('data', args[0], peer);
      return emit.call(this, event, ...args);
    } as typeof socket.emit;
    const write = socket.write;
    socket.write = function (this: net.Socket, data: any, ...args: any[]) {
      component.emit('transmit', data, peer);
      return write.call(this, data, ...args);
    } as typeof socket.write;
    /* end(data) writes without calling write */
    const end = socket.end;
    socket.end = function (this: net.Socket, data?: any, ...args: any[]) {
      if (data != null && typeof data !== 'function')
        component.emit('transmit', data, peer);
      return end.call(this, data, ...args);
    } as typeof socket.end;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async _start(abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onListening = () => {
        this.server.removeListener('error', onError);
        resolve();
      };
      const onError = error => {
        this.server.removeListener('listening', onListening);
        reject(error);
      };
      this.server.once('listening', onListening);
      this.server.once('error', onError);
      this.server.listen(this.values.port, this.values.bindInterface);
    });
  }

  protected async _stop(): Promise<void> {
    return new Promise<void>(resolve => {
      this.server.close(() => resolve());
      // The server waits for its connections to end
      for (const socket of this._sockets) socket.destroy();
    });
  }
}

/**
 * @namespace
 */
export namespace TcpServerComponent {
  export interface Events extends IoServerBaseComponent.Events {}

  export const Variables = TcpServerVariables;
  export type Variables = TcpServerVariables;
  export const TlsVariables = TcpServerTlsVariables;
  export type TlsVariables = TcpServerTlsVariables;

  export function variablesToNodeOptions(
    values: TcpServerVariables,
  ): tls.TlsOptions {
    return tcpServerVariablesToNodeOptions(values);
  }
}
