import {
  formatCount,
  IoClientBaseComponent,
  PerMinute,
  renewWhileRunning,
} from '@syncbridge/builtins';
import {
  Component,
  ComponentBase,
  LogChannel,
  UseDashboard,
} from '@syncbridge/common';
import * as ioredis from 'ioredis';
import { CommonRedisVariables } from './common-redis.variables.js';
import { RedisDashboard } from './redis.dashboard.js';

@Component({
  displayName: 'Redis Client',
  description: 'Redis client component',
  summary:
    'Abstract base of the Redis components: the settings, events and communication log they share.',
  tags: ['redis', 'client'],
  abstract: true,
})
export class RedisComponent<
  TEvents extends RedisComponent.Events = RedisComponent.Events,
> extends ComponentBase<TEvents> {
  @Component.UseVariables()
  declare values: CommonRedisVariables;

  /** Its connection to Redis: connected, lost, connecting again */
  @LogChannel({
    name: 'communication',
    title: 'Communication',
    description: 'Its connection to Redis',
    kind: 'transmit',
    retentionDays: 14,
    /* Off unless turned on, as every component's communication */
    enabled: false,
    events: ['connect', 'disconnect', 'reconnecting'],
  })
  declare readonly communicationLog: LogChannel;

  /** Its connection: shown where an app includes it */
  @UseDashboard({ title: 'Redis' })
  declare readonly connection: RedisDashboard;

  protected _reconnects!: number;
  /* The last minute's commands and failed ones: its activity line */
  protected _perMinute!: Record<'commands' | 'failed', PerMinute>;

  protected async _init(): Promise<void> {
    await super._init();
    this._reconnects = 0;
    this._perMinute = { commands: new PerMinute(), failed: new PerMinute() };
    renewWhileRunning(
      this,
      () => {
        this.setGlance(this._glanceText);
        this._renewActivity();
      },
      () => {
        this.setActivity(undefined);
        this._perMinute.commands.clear();
        this._perMinute.failed.clear();
      },
    );
    this.connection?.link.set('unknown', 'Not connected');
    this.connection?.reconnects.set(0);
    const note = (event: string, message: string) =>
      this.communicationLog?.write({ direction: 'info', event, message });
    this.on('connect', () => {
      note('connect', 'Connected');
      this.connection?.link.set('ok', 'Connected');
    });
    this.on('disconnect', error => {
      const message = error ? `Disconnected: ${error.message}` : 'Disconnected';
      note('disconnect', message);
      this.connection?.link.set(error ? 'error' : 'warning', message);
    });
    this.on('reconnecting', () => {
      note('reconnecting', 'Connecting again');
      this.connection?.link.set('warning', 'Connecting again');
      this.connection?.reconnects.set(++this._reconnects);
    });
  }

  /** What its glance shows: the server it connects to */
  protected get _glanceText(): string | undefined {
    return undefined;
  }

  /** Commands of the last minute, and in warning those that failed */
  protected _renewActivity(): void {
    if (this.stopped) return;
    const failed = this._perMinute.failed.value;
    this.setActivity(
      `${formatCount(this._perMinute.commands.value)} commands/min` +
        (failed ? ` · ${formatCount(failed)} failed` : ''),
      failed ? 'warning' : undefined,
    );
  }

  /**
   * Counts the commands the apps send through the client, once it is
   * ready: those of its own handshake are not theirs
   */
  protected _watchClient(client: ioredis.Redis): void {
    const sendCommand = client.sendCommand;
    client.sendCommand = ((command: ioredis.Command, stream?: any) => {
      const result = sendCommand.call(client, command, stream);
      if (client.status === 'ready') {
        this._perMinute.commands.add();
        command.promise.catch(() => {
          this._perMinute.failed.add();
          this._renewActivity();
        });
        this._renewActivity();
      }
      return result;
    }) as typeof client.sendCommand;
  }

  get client(): ioredis.Redis | ioredis.Cluster {
    throw new Error('Not implemented');
  }
}

/**
 * @namespace
 */
export namespace RedisComponent {
  export interface Events extends IoClientBaseComponent.Events {
    connect: [];
    disconnect: [error: Error | undefined];
    reconnecting: [];
  }

  export const Variables = CommonRedisVariables;
  export type Variables = CommonRedisVariables;
}
