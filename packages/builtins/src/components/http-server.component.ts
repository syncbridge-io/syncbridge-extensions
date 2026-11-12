import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { Component, LogChannel } from '@syncbridge/common';
import { formatCount, PerMinute } from '../utils/activity.js';
import { peerOf } from '../utils/peer-of.js';
import {
  HttpServerProtocolVariables,
  HttpServerVariables,
  httpServerVariablesToNodeOptions,
} from './http-server.variables.js';
import { IoServerBaseComponent } from './io-server-base.component.js';
import { TcpServerTlsVariables } from './tcp-server.variables.js';

/**
 * HttpServer component
 */
@Component({
  className: 'HttpServer',
  displayName: 'Http Server',
  description: 'Http server component',
  summary:
    'Runs an HTTP or HTTPS server for an app to answer requests with, with TLS and socket limits.',
  tags: ['http', 'https', 'server'],
})
export class HttpServerComponent<
  TEvents extends HttpServerComponent.Events = HttpServerComponent.Events,
> extends IoServerBaseComponent<TEvents> {
  declare server: http.Server;

  @Component.UseVariables()
  declare values: HttpServerVariables;

  /** The requests it is sent and what it answers; not their bodies */
  @LogChannel({
    name: 'communication',
    title: 'Communication',
    description: 'The requests it is sent and what it answers',
    kind: 'transmit',
    retentionDays: 14,
    /* Off unless turned on, as every component's communication */
    enabled: false,
    events: ['request', 'response'],
  })
  declare readonly communicationLog: LogChannel;

  /* Requests, and those answered with a server error, in the last minute */
  protected _requestsPerMinute!: PerMinute;
  protected _failedPerMinute!: PerMinute;

  protected async _init(): Promise<void> {
    this._requestsPerMinute = new PerMinute();
    this._failedPerMinute = new PerMinute();
    await super._init();
    this._createServer();
  }

  protected get _glanceText(): string | undefined {
    return (
      (this.values.tls_enabled ? 'https' : 'http') +
      `://${this.values.bindInterface || '0.0.0.0'}:${this.values.port}`
    );
  }

  protected _clearActivity(): void {
    super._clearActivity();
    this._requestsPerMinute.clear();
    this._failedPerMinute.clear();
  }

  /** Requests, not bytes: what an HTTP server is asked to do */
  protected _renewActivity(): void {
    if (this.stopped) return;
    const failed = this._failedPerMinute.value;
    this.setActivity(
      `${formatCount(this._requestsPerMinute.value)} req/min` +
        (failed ? ` · ${formatCount(failed)} 5xx` : ''),
      failed ? 'warning' : undefined,
    );
  }

  /** The server, made once: apps add their handlers to it */
  protected _createServer() {
    const serverOptions = HttpServerComponent.variablesToNodeOptions(
      this.values,
    );
    if (this.values.tls_enabled) {
      this.server = https.createServer(serverOptions);
    } else this.server = http.createServer(serverOptions);
    /* Not options of createServer(): they are the server's properties */
    const { timeout, maxHeadersCount } = this.values.http ?? {};
    if (timeout != null) this.server.timeout = timeout;
    if (maxHeadersCount != null) this.server.maxHeadersCount = maxHeadersCount;
    this.server.on('request', (req, res) => this._watchRequest(req, res));
    this.server.once('listening', () => {
      this.logger?.info(
        `Http listener started on ` +
          (this.values.tls_enabled ? 'https' : 'http') +
          '://' +
          (this.values.bindInterface || 'localhost') +
          ':' +
          this.values.port,
      );
    });
  }

  /** A request and its answer, for the communication channel */
  protected _watchRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const started = Date.now();
    const details = peerOf({
      address: req.socket.remoteAddress,
      port: req.socket.remotePort,
    });
    const what = `${req.method} ${req.url}`;
    this._requestsPerMinute.add();
    this._renewActivity();
    this.communicationLog?.write({
      direction: 'in',
      event: 'request',
      message: what,
      details,
    });
    res.once('finish', () => {
      if (res.statusCode >= 500) {
        this._failedPerMinute.add();
        this._renewActivity();
      }
      this.communicationLog?.write({
        direction: 'out',
        event: 'response',
        message: `${res.statusCode} ${what} (${Date.now() - started} ms)`,
        details,
      });
    });
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
      // The server waits for its connections to end, keep-alive ones too
      this.server.closeAllConnections();
    });
  }
}

/**
 * @namespace
 */
export namespace HttpServerComponent {
  export interface Events extends IoServerBaseComponent.Events {}

  export const Variables = HttpServerVariables;
  export const TlsVariables = TcpServerTlsVariables;
  export const ProtocolVariables = HttpServerProtocolVariables;
  export type Variables = HttpServerVariables;
  export type TlsVariables = TcpServerTlsVariables;
  export type ProtocolVariables = HttpServerProtocolVariables;

  export function variablesToNodeOptions(
    values: HttpServerVariables,
  ): tls.TlsOptions {
    return httpServerVariablesToNodeOptions(values);
  }
}
