import path from 'node:path';
import { createTestEnv } from '@syncbridge/testing';
import { expect } from 'expect';
import { HttpServerComponent, UdpListenerComponent } from '../src/index.js';
import { EchoApp } from './_fixtures/echo-ext/src/index.js';

const FIXTURE = path.resolve(import.meta.dirname, '_fixtures/echo-ext');

/** A component outside an app, started as the engine starts it */
function create<T>(Class: new (init: any) => T, values: object): T {
  return new Class({
    app: {} as any,
    parent: {} as any,
    name: 'it',
    path: 'it',
    values,
  });
}

describe('Glance and activity lines', () => {
  const env = createTestEnv({ from: FIXTURE });

  afterEach(() => env.reset());
  after(() => env.dispose());

  it('should show what a client connects to, and its bytes of the last minute', async () => {
    const device = env.serve({ port: 4101 });
    const app = await env.start(EchoApp, {
      components: {
        listener: { values: { port: 7 } },
        device: { values: { host: 'analyzer.lab', port: 4101 } },
      },
    });
    const conn = await device.connection();
    await conn.receive();
    conn.send('result 42');
    await env.waitForEvent(app.device!, 'data');
    expect(app.device!.glance).toEqual({ text: 'analyzer.lab:4101' });
    expect(app.device!.activity).toEqual({ text: '↓ 9 B ↑ 5 B /min' });
  });

  it('should show where a server listens, its clients and their bytes', async () => {
    const app = await env.start(EchoApp, {
      components: { listener: { values: { port: 7 } } },
    });
    expect(app.listener.glance).toEqual({ text: '0.0.0.0:7' });
    expect(app.listener.activity).toEqual({
      text: '0 clients · ↓ 0 B ↑ 0 B /min',
    });
    const conn = await env.connect(app, 'listener');
    await conn.request('ping');
    expect(app.listener.activity).toEqual({
      text: '1 client · ↓ 4 B ↑ 4 B /min',
    });
  });

  it('should drop the activity when stopped, and keep the glance', async () => {
    const app = await env.start(EchoApp, {
      components: { listener: { values: { port: 7 } } },
    });
    await app.listener.stop();
    expect(app.listener.activity).toBeUndefined();
    expect(app.listener.glance).toEqual({ text: '0.0.0.0:7' });
  });

  it('should show where a UDP listener listens', async () => {
    const listener = create(UdpListenerComponent, {
      port: 0,
      bindInterface: '127.0.0.1',
    });
    await listener.start();
    try {
      expect(listener.glance).toEqual({ text: '127.0.0.1:0' });
      expect(listener.activity).toEqual({ text: '↓ 0 B ↑ 0 B /min' });
    } finally {
      await listener.stop();
    }
  });

  it("should show an HTTP server's requests of the last minute, and its server errors", async () => {
    const server = create(HttpServerComponent, {
      port: 0,
      bindInterface: '127.0.0.1',
    });
    await server.init();
    server.server.on('request', (req, res) => {
      res.statusCode = req.url === '/fail' ? 500 : 200;
      res.end();
    });
    await server.start();
    try {
      const { port } = server.server.address() as { port: number };
      expect(server.glance).toEqual({ text: 'http://127.0.0.1:0' });
      await fetch(`http://127.0.0.1:${port}/`);
      expect(server.activity).toEqual({ text: '1 req/min' });
      await fetch(`http://127.0.0.1:${port}/fail`);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(server.activity).toEqual({
        text: '2 req/min · 1 5xx',
        tone: 'warning',
      });
    } finally {
      await server.stop();
    }
  });
});
