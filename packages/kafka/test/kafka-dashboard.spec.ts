import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createTestEnv } from '@syncbridge/testing';
import { expect } from 'expect';
import { OrdersApp } from './_fixtures/kafka-ext/src/index.js';

const FIXTURE = path.resolve(import.meta.dirname, '_fixtures/kafka-ext');

/** Where nothing listens: the real clients are built, and never reach a broker */
const CONNECTION = {
  brokers: ['127.0.0.1:1'],
  retries: 0,
  connectTimeout: 0.2,
};

describe('Kafka dashboard', () => {
  const env = createTestEnv({ from: FIXTURE });

  afterEach(() => env.reset());
  after(() => env.dispose());

  /** The app created, not started: its clients are driven by the test */
  async function createApp() {
    const app = await env.create(OrdersApp, {
      components: {
        consumer: {
          values: { connection: CONNECTION, groupId: 'g', topics: ['orders'] },
        },
        producer: { values: { connection: CONNECTION } },
      },
    });
    await app.init();
    return app;
  }

  it("should show a consumer's brokers, messages by topic and rate", async () => {
    const app = await createApp();
    const consumer = app.consumer;
    const stream = new EventEmitter();
    (consumer.consumer as any).consume = async () => stream;
    expect(env.dashboard(app, 'consumer/kafka/link')).toMatchObject({
      value: { status: 'unknown', text: 'Not connected' },
    });
    consumer.consumer.emit('client:broker:connect', {} as any);
    expect(env.dashboard(app, 'consumer/kafka/link')).toMatchObject({
      value: { status: 'ok', text: 'Connected' },
    });

    await (consumer as any)._startConsumer();
    for (const topic of ['orders', 'orders', 'returns'])
      stream.emit('data', { topic, partition: 0, offset: 1n, value: 'x' });
    await new Promise(setImmediate);
    expect(env.dashboard(app, 'consumer/kafka/topics')).toMatchObject({
      rows: [
        { key: 'orders', row: { value: 2 } },
        { key: 'returns', row: { value: 1 } },
      ],
    });
    env.flushCounts(app);
    expect(env.dashboard(app, 'consumer/kafka/rate')).toMatchObject({
      series: { messages: [[expect.any(Number), 3]] },
    });
    expect(env.dashboardIssues(app)).toEqual({});
  });

  it("should count a producer's messages, and the sends that failed", async () => {
    const app = await createApp();
    const producer = app.producer;
    let fail = false;
    (producer.producer as any).send = async () => {
      if (fail) throw new Error('No leader');
      return {};
    };
    await producer.send({
      messages: [{ topic: 'invoices', value: Buffer.from('1') }],
    });
    fail = true;
    await expect(
      producer.send({
        messages: [{ topic: 'invoices', value: Buffer.from('2') }],
      }),
    ).rejects.toThrow('No leader');

    expect(env.dashboard(app, 'producer/kafka/topics')).toMatchObject({
      rows: [{ key: 'invoices', row: { value: 1 } }],
    });
    expect(env.dashboard(app, 'producer/kafka/errors')).toMatchObject({
      value: 1,
    });
    producer.producer.emit('client:broker:failed', {} as any);
    expect(env.dashboard(app, 'producer/kafka/link')).toMatchObject({
      value: { status: 'error', text: 'Kafka broker failed' },
    });
  });

  it("should show a client's brokers and topics, and its messages of the last minute", async () => {
    const app = await createApp();
    const { consumer, producer } = app;
    /* Running, as far as its lines go: no broker is reached */
    (consumer as any).setStatus('started');
    (producer as any).setStatus('started');
    expect(consumer.glance).toEqual({ text: '127.0.0.1:1 · orders' });
    expect(producer.glance).toEqual({ text: '127.0.0.1:1' });

    const stream = new EventEmitter();
    (consumer.consumer as any).consume = async () => stream;
    await (consumer as any)._startConsumer();
    stream.emit('data', { topic: 'orders', partition: 0, offset: 1n });
    stream.emit('data', { topic: 'orders', partition: 0, offset: 2n });
    await new Promise(setImmediate);
    expect(consumer.activity).toEqual({ text: '2 msg/min' });

    (producer.producer as any).send = async () => {
      throw new Error('No leader');
    };
    await expect(
      producer.send({ messages: [{ topic: 'x', value: Buffer.from('1') }] }),
    ).rejects.toThrow();
    expect(producer.activity).toEqual({
      text: '0 msg/min · 1 failed',
      tone: 'warning',
    });
    (consumer as any).setStatus('stopped');
    expect(consumer.activity).toBeUndefined();
  });
});
