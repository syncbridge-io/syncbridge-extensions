import path from 'node:path';
import { createTestEnv } from '@syncbridge/testing';
import { expect } from 'expect';
import { FakeRedis } from './_fixtures/fake-redis.js';
import { CacheApp } from './_fixtures/redis-ext/src/index.js';

const FIXTURE = path.resolve(import.meta.dirname, '_fixtures/redis-ext');

describe('Redis dashboard', () => {
  /* The fake server listens on a real port */
  const env = createTestEnv({ from: FIXTURE, network: 'real' });
  let redis: FakeRedis;

  beforeEach(async () => {
    redis = await new FakeRedis().listen();
  });
  afterEach(async () => {
    await env.reset();
    await redis.close();
  });
  after(() => env.dispose());

  it('should show the connection, and count the reconnects', async () => {
    const app = await env.start(CacheApp, {
      components: {
        redis: { values: { host: '127.0.0.1', port: redis.port } },
      },
    });
    expect(env.dashboard(app, 'redis/connection/link')).toMatchObject({
      value: { status: 'ok', text: 'Connected' },
    });
    expect(env.dashboard(app, 'redis/connection/reconnects')).toMatchObject({
      value: 0,
    });

    redis.drop();
    await env.waitForEvent(app.redis, 'reconnecting');
    expect(env.dashboard(app, 'redis/connection/reconnects')).toMatchObject({
      value: 1,
    });
    await env.waitForEvent(app.redis, 'connect');
    expect(env.dashboard(app, 'redis/connection/link')).toMatchObject({
      value: { status: 'ok', text: 'Connected' },
    });
    expect(env.dashboardIssues(app)).toEqual({});
  });

  it('should show the server, and the commands of the last minute', async () => {
    const app = await env.start(CacheApp, {
      components: {
        redis: { values: { host: '127.0.0.1', port: redis.port, db: 2 } },
      },
    });
    expect(app.redis.glance).toEqual({ text: `127.0.0.1:${redis.port} db 2` });
    expect(app.redis.activity).toEqual({ text: '0 commands/min' });
    await app.redis.client.set('a', '1');
    await app.redis.client.get('a');
    expect(app.redis.activity).toEqual({ text: '2 commands/min' });
  });
});
