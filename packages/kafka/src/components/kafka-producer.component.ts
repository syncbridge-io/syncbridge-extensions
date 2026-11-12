import type {
  ProduceResult,
  SendOptions,
  Serializers,
} from '@platformatic/kafka';
import { ProduceAcks, Producer } from '@platformatic/kafka';
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
import { KafkaProducerVariables } from './kafka-producer.variables.js';

export const kTransaction = Symbol('plt.kafka.producer.transactions');

/**
 * KafkaProducer component
 */
@Component({
  className: 'KafkaProducer',
  displayName: 'Kafka Producer',
  description: 'Kafka producer component',
  summary:
    'Sends messages to Kafka topics, with acknowledgement and compression settings, SASL and TLS.',
  tags: ['producer'],
})
export class KafkaProducerComponent<
  TEvents extends KafkaProducerComponent.Events = KafkaProducerComponent.Events,
  Key = Buffer,
  Value = Buffer,
  HeaderKey = Buffer,
  HeaderValue = Buffer,
> extends ComponentBase<TEvents> {
  protected _stopping?: boolean;
  declare producer: Producer<Key, Value, HeaderKey, HeaderValue>;

  @Component.UseVariables()
  declare values: KafkaProducerVariables;

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
        this.setGlance(kafkaGlance(this.values.connection?.brokers));
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
    this.on('error', () => this.kafka?.errors.set(++this._errors));
    this.on('values-updated', async () => {
      await this._configureProducer();
    });
    await this._configureProducer();
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this._stopping = false;
    await this._startProducer();
  }

  protected async _stop(): Promise<void> {
    this._stopping = true;
    await this.producer?.close();
    return super._stop();
  }

  protected async _terminate(): Promise<void> {
    this._stopping = true;
    await this.producer?.close(true).catch(noOp);
  }

  protected async _configureProducer(options?: {
    serializers?: Partial<Serializers<any, any, any, any>>;
  }) {
    const isStopped = this.stopped;
    if (!isStopped) this.setStatus(ServiceStatus.starting);
    try {
      // The old client's disconnect is expected, not a failure
      this._stopping = true;
      await this.producer?.close();
      this._stopping = isStopped;
      this.producer = new Producer({
        ...options,
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
        // Producer options
        producerId: this.values.producerId,
        producerEpoch: this.values.producerEpoch,
        autocreateTopics: this.values.autocreateTopics,
        idempotent: this.values.idempotent,
        transactionalId: this.values.transactionalId,
        acks: this.values.acks
          ? this.values.acks === 'all'
            ? ProduceAcks.ALL
            : this.values.acks === 'no-response'
              ? ProduceAcks.NO_RESPONSE
              : ProduceAcks.LEADER
          : undefined,
        compression: this.values.compression,
        repeatOnStaleMetadata: this.values.repeatOnStaleMetadata,
      });

      this.producer.on('client:broker:connect', () => {
        this.setStatus(ServiceStatus.started);
        this.kafka?.link.set('ok', 'Connected');
        this.communicationLog?.write({
          direction: 'info',
          event: 'connect',
          message: 'Connected',
        });
        this.emit('connect');
      });
      this.producer.on('client:broker:failed', () => {
        this.setStatus(ServiceStatus.unhealthy, 'Kafka broker failed');
        this.kafka?.link.set('error', 'Kafka broker failed');
        this.communicationLog?.write({
          direction: 'info',
          event: 'error',
          message: 'Kafka broker failed',
        });
      });
      this.producer.on('client:broker:disconnect', () => {
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
        await this._startProducer();
      }
    } catch (err: any) {
      this.logger?.error(err);
      this.setStatus(ServiceStatus.unhealthy, err.message);
    }
  }

  protected async _startProducer(): Promise<void> {
    /* Test connection */
    await this.producer.listApis().catch(async e => {
      this.emit('error', e);
      this.setStatus(ServiceStatus.unhealthy, e.message);
    });
  }

  async send(
    options: SendOptions<Key, Value, HeaderKey, HeaderValue> & {
      [kTransaction]?: number;
    },
  ): Promise<ProduceResult> {
    let result: ProduceResult;
    try {
      result = await this.producer.send(options);
    } catch (err) {
      this.kafka?.errors.set(++this._errors);
      this._perMinute.failed.add();
      this._renewActivity();
      throw err;
    }
    for (const message of options.messages) {
      this.communicationLog?.write({
        direction: 'out',
        data: messageData(message.value),
        details: messageDetails(message),
      });
      this._count(message.topic);
    }
    return result;
  }

  protected _renewActivity(): void {
    if (this.stopped) return;
    this.setActivity(
      ...kafkaActivity(
        this._perMinute.messages.value,
        this._perMinute.failed.value,
        'failed',
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
export namespace KafkaProducerComponent {
  export interface Events extends ComponentBase.Events {
    connect: [];
    disconnect: [];
  }

  export const Variables = KafkaProducerVariables;
  export type Variables = KafkaProducerVariables;
  export const SaslVariables = KafkaSaslVariables;
  export type SaslVariables = KafkaSaslVariables;
  export const TlsVariables: typeof TcpClientComponent.TlsVariables =
    TcpClientComponent.TlsVariables;
  export type TlsVariables = TcpClientComponent.TlsVariables;
}
