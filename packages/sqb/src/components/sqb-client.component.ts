import { clearTimeout } from 'node:timers';
import { SqbClient, SQBError } from '@sqb/connect';
import {
  formatCount,
  PerMinute,
  renewWhileRunning,
} from '@syncbridge/builtins';
import {
  Component,
  ComponentBase,
  LogChannel,
  ServiceStatus,
  UseDashboard,
  WorkerPermission,
} from '@syncbridge/common';
import colors from 'ansi-colors';
import { noOp } from '../constants.js';
import { SqbClientDashboard } from './sqb-client.dashboard.js';
import {
  SqbClientPoolVariables,
  SqbClientVariables,
} from './sqb-client.variables.js';

/* Each dialect's adapter registers itself with SQB when imported. It is
 * imported only when chosen, so a worker loads one driver, not all */
const adapters: Record<string, () => Promise<unknown>> = {
  postgres: () => import('@sqb/postgres'),
  oracle: () => import('@sqb/oracle'),
  mssql: () => import('@sqb/mssql'),
  mysql: () => import('@sqb/mysql'),
  mariadb: () => import('@sqb/mariadb'),
  sqlite: () => import('@sqb/sqlite'),
};

/**
 * SqbClient component
 */
@Component({
  className: 'SqbClient',
  displayName: 'SqbClient',
  description: 'Database Connection Client',
  /* A worker may load native code only when told: oracledb is a native addon */
  permissions: [WorkerPermission.NativeCode],
  summary:
    'Connects to a PostgreSQL, Oracle, SQL Server, MySQL, MariaDB or SQLite database through SQB, with a connection pool and a log of the SQL it runs.',
  tags: ['io', 'stream'],
})
export class SqbClientComponent<
  TEvents extends SqbClientComponent.Events = SqbClientComponent.Events,
> extends ComponentBase<TEvents> {
  protected _livenessTimer?: NodeJS.Timeout;
  declare protected client: SqbClient;

  @Component.UseVariables()
  declare values: SqbClientVariables;

  /** The SQL it runs, with its parameters, and what fails */
  @LogChannel({
    name: 'queries',
    title: 'Queries',
    description: 'The SQL it runs, with its parameters, and what fails',
    retentionDays: 7,
    /* Off unless turned on: queries are many, and their parameters may
     * hold what should not be kept */
    enabled: false,
    events: ['execute', 'error'],
  })
  declare readonly queriesLog: LogChannel;

  /** Its database, queries and pool: shown where an app includes it */
  @UseDashboard({ title: 'Database' })
  declare readonly database: SqbClientDashboard;

  protected _errors!: number;
  protected _inUse!: number;
  /* The last minute's queries and errors: its activity line */
  protected _perMinute!: Record<'queries' | 'errors', PerMinute>;

  protected async _init(): Promise<void> {
    await super._init();
    this._errors = 0;
    renewWhileRunning(
      this,
      () => {
        this.setGlance(this._glanceText);
        this._renewActivity();
      },
      () => this.setActivity(undefined),
    );
    this.database?.link.set('unknown', 'Not connected');
    this.database?.errors.set(0);
    await this._createClient();
    this.on('values-updated', () =>
      this._restart().catch(err =>
        this.setStatus(ServiceStatus.unhealthy, err.message),
      ),
    );
  }

  /** A client of the current values, for the next start; the old one is closed */
  protected async _createClient() {
    const loadAdapter = adapters[this.values.dialect];
    if (!loadAdapter)
      throw new Error(`Unknown database dialect "${this.values.dialect}"`);
    await loadAdapter();
    const client = new SqbClient({
      dialect: this.values.dialect,
      host: this.values.host,
      port: this.values.port,
      user: this.values.username,
      password: this.values.password,
      database: this.values.database,
      schema: this.values.schema,
      name: this.values.applicationName,
      pool: this.values.pool,
    });
    this.client = client;
    this._inUse = 0;
    /* A new client counts again, as its pool is new */
    this._perMinute = { queries: new PerMinute(), errors: new PerMinute() };
    this.database?.inUse.set(0);
    client.on('error', (err: Error) => {
      if (err instanceof SQBError && this.logger?.level === 'debug') {
        const query = err.request?.sql || String(err.query);
        this.logger.debug(
          err.message +
            `\nSQL: ${colors.whiteBright(query)}\n${
              err.request?.params
                ? 'Params: \n   ' +
                  Object.entries(err.request.params)
                    .map(
                      ([key, value]) =>
                        `${colors.yellow(key)}: ${colors.yellowBright(String(value))}`,
                    )
                    .join(`\n   `)
                : ''
            }`,
          {
            query,
            dialect: err.request?.dialect,
            params: err.request?.params,
          },
        );
      }
    });
    client.on('execute', request => {
      this.queriesLog?.write({
        level: 'info',
        event: 'execute',
        message: request.sql,
        fields: request.params ? { params: request.params } : undefined,
      });
      this.database?.rate.count('queries');
      this._perMinute.queries.add();
      this._renewActivity();
    });
    client.on('error', (err: Error) => {
      this.database?.errors.set(++this._errors);
      this.database?.rate.count('errors');
      this._perMinute.errors.add();
      this._renewActivity();
      this.queriesLog?.write({
        level: 'error',
        event: 'error',
        message:
          err instanceof SQBError && err.request?.sql
            ? `${err.message}\nSQL: ${err.request.sql}`
            : err.message,
        fields:
          err instanceof SQBError && err.request?.params
            ? { params: err.request.params }
            : undefined,
      });
    });
    client.on('acquire', async () => {
      this._resetLiveness();
      if (client !== this.client) return;
      this.database?.inUse.set(++this._inUse);
      this._renewActivity();
    });
    client.on('connection-return', async () => {
      if (client !== this.client) return;
      this.database?.inUse.set(--this._inUse);
      this._renewActivity();
    });
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    // The values are the client's: it is built again to take them
    await this.client?.close().catch(noOp);
    await this._createClient();
    await this._testConnection(abortSignal);
  }

  protected async _stop(): Promise<void> {
    clearTimeout(this._livenessTimer);
    await this.client.close();
    return super._stop();
  }

  protected async _terminate(): Promise<void> {
    clearTimeout(this._livenessTimer);
    await this.client.close(0);
  }

  /** Its database: the dialect, and where - never who connects */
  protected get _glanceText(): string {
    const { dialect, host, port, database } = this.values;
    const where = host
      ? `${host}${port ? `:${port}` : ''}${database ? `/${database}` : ''}`
      : database;
    return where ? `${dialect} · ${where}` : dialect;
  }

  /**
   * Its pool, its queries of the last minute, and in warning the requests
   * waiting for a connection and the errors
   */
  protected _renewActivity(): void {
    if (this.stopped) return;
    const waiting = this.client?.pool?.pending ?? 0;
    const errors = this._perMinute.errors.value;
    const max = this.values.pool?.max;
    const parts = [
      `pool ${this._inUse}${max ? `/${max}` : ''}`,
      `${formatCount(this._perMinute.queries.value)} queries/min`,
      waiting && `${formatCount(waiting)} waiting`,
      errors && `${formatCount(errors)} ${errors === 1 ? 'error' : 'errors'}`,
    ];
    this.setActivity(
      parts.filter(Boolean).join(' · '),
      waiting || errors ? 'warning' : undefined,
    );
  }

  getClient() {
    if (!this.client) throw new Error('SqbClient component is not initialized');
    return this.client;
  }

  protected async _testConnection(abortSignal?: AbortSignal) {
    const onAbort = () => {
      abortSignal?.removeEventListener('abort', onAbort);
      this.client.close(0);
    };
    abortSignal?.addEventListener('abort', onAbort);
    return this.client
      .test()
      .then(() => {
        this.setStatus(ServiceStatus.started);
        this.database?.link.set('ok', `Connected to ${this.values.dialect}`);
      })
      .catch(err => {
        const msg = `Database connection failed. ${err.message}`;
        this.logger?.error(msg);
        this.database?.link.set('error', msg);
        this.setStatus(ServiceStatus.unhealthy, msg);
        throw err;
      })
      .finally(() => {
        abortSignal?.removeEventListener('abort', onAbort);
      });
  }

  /**
   * Test db connection health every 5 secs
   * @protected
   */
  protected _liveness() {
    this._testConnection()
      .catch(noOp)
      .finally(() => {
        this._resetLiveness();
      });
  }

  protected _resetLiveness() {
    clearTimeout(this._livenessTimer);
    if (this.stopped) return;
    this._livenessTimer = setTimeout(() => {
      this._liveness();
    }, 5000).unref();
  }
}

/**
 * @namespace
 */
export namespace SqbClientComponent {
  export interface Events extends ComponentBase.Events {}
  export const Variables = SqbClientVariables;
  export type Variables = SqbClientVariables;
  export const PoolVariables = SqbClientPoolVariables;
  export type PoolVariables = SqbClientPoolVariables;
}
