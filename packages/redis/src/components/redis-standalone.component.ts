import { omit } from '@jsopen/objects';
import { Component, ServiceStatus } from '@syncbridge/common';
import * as ioredis from 'ioredis';
import { stopClient } from '../utils/stop-client.js';
import { RedisComponent } from './redis.component.js';
import { RedisStandaloneVariables } from './redis-standalone.variables.js';

@Component({
  displayName: 'Redis Standalone Client',
  description: 'Redis standalone client component',
  summary:
    'Connects to a single Redis server and gives apps its ioredis client.',
  tags: ['standalone'],
})
export class RedisStandaloneComponent<
  TEvents extends RedisStandaloneComponent.Events =
    RedisStandaloneComponent.Events,
> extends RedisComponent<TEvents> {
  declare protected _client: ioredis.Redis;
  private _stopping?: boolean;

  @Component.UseVariables()
  declare values: RedisStandaloneVariables;

  get client(): ioredis.Redis {
    if (!this._client) throw new Error('Not initialized yet.');
    return this._client;
  }

  protected get _glanceText(): string | undefined {
    const { host, port, db } = this.values;
    return `${host || '127.0.0.1'}:${port || 6379}` + (db ? ` db ${db}` : '');
  }

  protected async _init(): Promise<void> {
    await super._init();
    const options: ioredis.RedisOptions = omit(this.values, [
      'tls',
      'tls_enabled',
    ]);
    if (this.values.tls_enabled) options.tls = this.values.tls ?? {};
    this._client = new ioredis.Redis({ ...options, lazyConnect: true });
    this._watchClient(this._client);
    this._client.on('error', err => this.logger?.error(err));
    this._client.on('close', (err?: Error) => {
      if (!this._stopping) {
        this.setStatus(
          ServiceStatus.unhealthy,
          err?.message ?? 'Connection closed unexpectedly',
        );
      }
      this.emitSafe('disconnect', err);
    });
    this._client.on('ready', () => {
      this.setStatus(ServiceStatus.started);
      this.emitSafe('connect');
    });
    this._client.on('reconnecting', () => {
      this.emitSafe('reconnecting');
    });
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this._stopping = false;
    await new Promise<void>((resolve, reject) => {
      if (this._client.status === 'ready') return resolve();
      const onError = (err: any) => {
        this.setStatus(ServiceStatus.unhealthy, err.message);
        this._client.removeListener('ready', onReady);
        // Otherwise it keeps retrying in the background
        this._client.disconnect();
        reject(err);
      };
      const onReady = () => {
        this._client.removeListener('error', onError);
        resolve();
      };
      this._client.once('error', onError);
      this._client.once('ready', onReady);
      // 'end' is where stop() leaves it: it connects again from there
      if (
        this._client.status === 'close' ||
        this._client.status === 'wait' ||
        this._client.status === 'end'
      )
        this._client.connect();
    });
  }

  protected async _stop(): Promise<void> {
    this._stopping = true;
    await stopClient(this._client);
    return super._stop();
  }
}

/**
 * @namespace
 */
export namespace RedisStandaloneComponent {
  export interface Events extends RedisComponent.Events {
    connect: [];
    disconnect: [error: Error | undefined];
    reconnecting: [];
  }

  export const Variables = RedisStandaloneVariables;
  export type Variables = RedisStandaloneVariables;
}
