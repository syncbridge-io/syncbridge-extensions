import {
  Consumer,
  FetchIsolationLevels,
  type Message,
  MessagesStream,
} from '@platformatic/kafka';
import {
  PerMinute,
  renewWhileRunning,
  TcpClientComponent,
} from '@syncbridge/builtins';
import {
  Component,
  ComponentBase,
  LogChannel,
  ServiceStatus,
  UseDashboard,
} from '@syncbridge/common';
import { noOp } from '../constants.js';
import {
  COMMUNICATION_CHANNEL,
  messageData,
  messageDetails,
} from '../utils/communication.js';
import { kafkaActivity, kafkaGlance } from '../utils/lines.js';
import { KafkaDashboard } from './kafka.dashboard.js';
import { KafkaSaslVariables } from './kafka-client.variables.js';
import { KafkaConsumerVariables } from './kafka-consumer.variables.js';

/**
 * KafkaConsumer component
 */
@Component({
  className: 'KafkaConsumer',
  displayName: 'Kafka Consumer',
  description: 'Kafka consumer component',
  summary:
    'Reads messages from Kafka topics as a member of a consumer group, with SASL and TLS.',
  tags: ['consumer'],
})
export class KafkaConsumerComponent<
  TEvents extends KafkaConsumerComponent.Events = KafkaConsumerComponent.Events,
> extends ComponentBase<TEvents> {
  protected _stopping?: boolean;
  declare consumer: Consumer;
  declare stream: MessagesStream<any, any, any, any>;

  @Component.UseVariables()
  declare values: KafkaConsumerVariables;

  @LogChannel(COMMUNICATION_CHANNEL)
  declare readonly communicationLog: LogChannel;

  /** Its brokers, messages and errors: shown where an app includes it */
  @UseDashboard({ title: 'Kafka' })
  declare readonly kafka: KafkaDashboard;

  protected _errors!: number;
  protected _byTopic!: Map<string, number>;
  /* The last minute's messages and failures: its activity line */
  protected _perMinute!: Record<'messages' | 'failed', PerMinute>;

  protected async _init(): Promise<void> {
    await super._init();
    this._errors = 0;
    this._byTopic = new Map();
    this._perMinute = { messages: new PerMinute(), failed: new PerMinute() };
    renewWhileRunning(
      this,
      () => {
        this.setGlance(
          kafkaGlance(this.values.connection?.brokers, this.values.topics),
        );
        this._renewActivity();
      },
      () => {
        this.setActivity(undefined);
        this._perMinute.messages.clear();
        this._perMinute.failed.clear();
      },
    );
    this.kafka?.link.set('unknown', 'Not connected');
    this.kafka?.errors.set(0);
    this.on('error', () => {
      this.kafka?.errors.set(++this._errors);
      this._perMinute.failed.add();
      this._renewActivity();
    });
    this.on('values-updated', async () => {
      await this._configureConsumer();
    });
    await this._configureConsumer();
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this._stopping = false;
    await this._startConsumer();
  }

  protected async _stop(): Promise<void> {
    this._stopping = true;
    await this.stream?.close().catch(noOp);
    await this.consumer?.close();
    return super._stop();
  }

  protected async _terminate(): Promise<void> {
    this._stopping = true;
    await this.consumer?.close(true).catch(noOp);
  }

  protected async _configureConsumer() {
    const isStopped = this.stopped;
    if (!isStopped) this.setStatus(ServiceStatus.starting);
    try {
      // The old client's disconnect is expected, not a failure
      this._stopping = true;
      await this.stream?.close().catch(noOp);
      await this.consumer?.close();
      this._stopping = isStopped;
      this.consumer = new Consumer({
        // Client options
        clientId: this.values.connection.clientId || this._context.path,
        bootstrapBrokers: this.values.connection.brokers,
        timeout: this.values.connection.timeout,
        retries:
          this.values.connection.retries < 0
            ? true
            : this.values.connection.retries,
        retryDelay: this.values.connection.retryDelay * 1000,
        metadataMaxAge: this.values.connection.metadataMaxAge * 1000,
        connectTimeout: this.values.connection.connectTimeout * 1000,
        requestTimeout: this.values.connection.requestTimeout * 1000,
        maxInflights: this.values.connection.maxInflights,
        ssl: this.values.connection.tls_enabled
          ? this.values.connection.tls
          : undefined,
        tlsServerName: this.values.connection.tls_enabled
          ? this.values.connection.tls?.servername
          : undefined,
        sasl: this.values.connection.sasl_enabled
          ? this.values.connection.sasl
          : undefined,
        // Consumer options
        groupId: this.values.groupId,
        groupInstanceId: this.values.groupInstanceId,
        autocommit: this.values.autocommit,
        autocreateTopics: this.values.autocreateTopics,
        minBytes: this.values.minBytes,
        maxBytes: this.values.maxBytes,
        maxWaitTime: this.values.maxWaitTime * 1000,
        isolationLevel:
          this.values.isolationLevel === 'read-committed'
            ? FetchIsolationLevels.READ_COMMITTED
            : FetchIsolationLevels.READ_UNCOMMITTED,
        highWaterMark: this.values.highWaterMark,
        sessionTimeout: this.values.sessionTimeout * 1000,
        rebalanceTimeout: this.values.rebalanceTimeout * 1000,
        heartbeatInterval: this.values.heartbeatInterval * 1000,
        groupProtocol: this.values.groupProtocol,
      });

      this.consumer.on('client:broker:connect', () => {
        this.setStatus(ServiceStatus.started);
        this.kafka?.link.set('ok', 'Connected');
        this.communicationLog?.write({
          direction: 'info',
          event: 'connect',
          message: 'Connected',
        });
        this.emit('connect');
      });
      this.consumer.on('client:broker:failed', () => {
        this.setStatus(ServiceStatus.unhealthy, 'Kafka broker failed');
        this.kafka?.link.set('error', 'Kafka broker failed');
        this.communicationLog?.write({
          direction: 'info',
          event: 'error',
          message: 'Kafka broker failed',
        });
      });
      this.consumer.on('client:broker:disconnect', () => {
        if (!this._stopping) {
          this.setStatus(
            ServiceStatus.unhealthy,
            'Kafka broker disconnected unexpectedly',
          );
        }
        this.kafka?.link.set(
          this._stopping ? 'unknown' : 'warning',
          'Disconnected',
        );
        this.communicationLog?.write({
          direction: 'info',
          event: 'disconnect',
          message: 'Disconnected',
        });
        this.emit('disconnect');
      });
      if (!isStopped) {
        await this._startConsumer();
      }
    } catch (err: any) {
      this.logger?.error(err);
      this.setStatus(ServiceStatus.unhealthy, err.message);
    }
  }

  protected async _startConsumer(): Promise<void> {
    await Promise.resolve()
      .then(async () => {
        this.stream = await this.consumer.consume({
          topics: this.values.topics,
          mode: this.values.mode,
          fallbackMode: this.values.fallbackMode,
          maxFetches: this.values.maxFetches,
        });
        this.stream.on('data', message => {
          this._onMessage(message).catch(e => this.emit('error', e));
        });
        this.stream.on('error', e => {
          if (this._stopping) return;
          this.emit('error', e);
          this.setStatus(ServiceStatus.unhealthy, e.message);
        });
      })
      .catch(async e => {
        this.emit('error', e);
        this.setStatus(ServiceStatus.unhealthy, e.message);
      });
  }

  protected async _onMessage(message: Message<any, any, any, any>) {
    this.communicationLog?.write({
      direction: 'in',
      data: messageData(message.value),
      details: messageDetails(message),
    });
    this._count(message.topic);
    this.emit('message', message);
  }

  protected _renewActivity(): void {
    if (this.stopped) return;
    this.setActivity(
      ...kafkaActivity(
        this._perMinute.messages.value,
        this._perMinute.failed.value,
        'errors',
      ),
    );
  }

  /** A message read or written: its rate, and its topic's bar */
  protected _count(topic: string | undefined) {
    this._perMinute.messages.add();
    this._renewActivity();
    if (!this.kafka) return;
    this.kafka.rate.count('messages');
    if (!topic) return;
    const n = (this._byTopic.get(topic) ?? 0) + 1;
    this._byTopic.set(topic, n);
    this.kafka.topics.upsert(topic, { value: n });
  }
}

/**
 * @namespace
 */
export namespace KafkaConsumerComponent {
  export interface Events extends ComponentBase.Events {
    message: [msg: Message<any, any, any, any>];
    connect: [];
    disconnect: [];
  }

  export const Variables = KafkaConsumerVariables;
  export type Variables = KafkaConsumerVariables;
  export const SaslVariables = KafkaSaslVariables;
  export type SaslVariables = KafkaSaslVariables;
  export const TlsVariables: typeof TcpClientComponent.TlsVariables =
    TcpClientComponent.TlsVariables;
  export type TlsVariables = TcpClientComponent.TlsVariables;
}
