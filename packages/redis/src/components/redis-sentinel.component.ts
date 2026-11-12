import { omit } from '@jsopen/objects';
import { Component, ServiceStatus } from '@syncbridge/common';
import * as ioredis from 'ioredis';
import type { SentinelConnectionOptions } from 'ioredis/built/connectors/SentinelConnector/index.js';
import type { CommonRedisOptions } from 'ioredis/built/redis/RedisOptions.js';
import { stopClient } from '../utils/stop-client.js';
import { RedisComponent } from './redis.component.js';
import { RedisSentinelVariables } from './redis-sentinel.variables.js';

@Component({
  displayName: 'Redis Sentinel Client',
  description: 'Redis sentinel client component',
  summary:
    'Connects to the master of a Redis Sentinel group and gives apps its ioredis client.',
  tags: ['sentinel'],
})
export class RedisSentinelComponent<
  TEvents extends RedisSentinelComponent.Events = RedisSentinelComponent.Events,
> extends RedisComponent<TEvents> {
  declare protected _client: ioredis.Redis;
  private _stopping?: boolean;

  @Component.UseVariables()
  declare values: RedisSentinelVariables;

  get client(): ioredis.Redis {
    if (!this._client) throw new Error('Not initialized yet.');
    return this._client;
  }

  /** The master it asks the sentinels for, and how many they are */
  protected get _glanceText(): string | undefined {
    const n = this.values.sentinels?.length ?? 0;
    return (
      `${this.values.name} · ${n} ${n === 1 ? 'sentinel' : 'sentinels'}` +
      (this.values.db ? ` · db ${this.values.db}` : '')
    );
  }

  protected async _init(): Promise<void> {
    await super._init();
    const options: CommonRedisOptions & SentinelConnectionOptions = omit(
      this.values,
      ['sentinelTls', 'sentinelTls_enabled', 'tls', 'tls_enabled'],
    );
    options.lazyConnect = true;
    if (this.values.tls_enabled) options.tls = this.values.tls ?? {};
    options.enableTLSForSentinelMode = this.values.sentinelTls_enabled;
    if (options.enableTLSForSentinelMode)
      options.sentinelTLS = this.values.sentinelTls;
    this._client = new ioredis.Redis(options);
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
      this._client.connect(err => {
        if (err) {
          this.setStatus(ServiceStatus.unhealthy, err.message);
          // Otherwise it keeps retrying in the background
          this._client.disconnect();
          reject(err);
          return;
        }
        resolve();
      });
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
export namespace RedisSentinelComponent {
  export interface Events extends RedisComponent.Events {
    connect: [];
    disconnect: [error: Error | undefined];
    reconnecting: [];
  }

  export const Variables = RedisSentinelVariables;
  export type Variables = RedisSentinelVariables;
}
