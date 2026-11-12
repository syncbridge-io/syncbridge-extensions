import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { createTestEnv } from '@syncbridge/testing';
import { expect } from 'expect';
import { IOBridgeApp, TcpClientComponent } from '../src/index.js';

/** A peer that keeps what is written to it */
class Peer extends EventEmitter {
  constructor(readonly name: string) {
    super();
  }
  glance?: { text: string };
  written: Buffer[] = [];
  connected = true;
  write(data: Buffer) {
    if (!this.connected) throw new Error('not connected');
    this.written.push(data);
  }
}

/** The app without an engine: _init reads its two peers alone */
async function createApp() {
  const app: any = Object.create(IOBridgeApp.prototype);
  app._context = { status: 'started' };
  app.peer1 = new Peer('peer1');
  app.peer2 = new Peer('peer2');
  app.components = {};
  const errors: Error[] = [];
  app.on('error', (e: Error) => errors.push(e));
  await app._init();
  return { app, errors, peer1: app.peer1 as Peer, peer2: app.peer2 as Peer };
}

describe('IOBridgeApp', () => {
  it('should pass what a peer reads on to the other peer', async () => {
    const { peer1, peer2 } = await createApp();
    peer1.emit('data', Buffer.from('to 2'));
    peer2.emit('data', Buffer.from('to 1'));
    expect(peer2.written.map(String)).toEqual(['to 2']);
    expect(peer1.written.map(String)).toEqual(['to 1']);
  });

  it('should tell an error when the other peer cannot be written', async () => {
    const { errors, peer1, peer2 } = await createApp();
    peer2.connected = false;
    peer1.emit('data', Buffer.from('lost'));
    expect(errors.map(e => e.message)).toEqual([
      'Failed to write data to peer2: not connected',
    ]);
  });
});

describe('IOBridgeApp lines', () => {
  it("should show its peers' glances side by side", async () => {
    const { app } = await createApp();
    expect(app.glance).toEqual({ text: 'peer1 ↔ peer2' });
    app.peer1.glance = { text: '/dev/ttyUSB0 9600 8N1' };
    app.peer2.glance = { text: '10.0.0.5:4000' };
    app.emit('component-line-change', app.peer1, 'glance', app.peer1.glance);
    expect(app.glance).toEqual({
      text: '/dev/ttyUSB0 9600 8N1 ↔ 10.0.0.5:4000',
    });
  });

  it('should show what it passed on each way, and what it dropped', async () => {
    const { app, peer1, peer2 } = await createApp();
    app.on('error', () => undefined);
    peer1.emit('data', Buffer.from('to 2'));
    peer2.emit('data', Buffer.from('1'));
    expect(app.activity).toEqual({ text: '→ 4 B ← 1 B /min' });
    peer2.connected = false;
    peer1.emit('data', Buffer.from('lost'));
    expect(app.activity).toEqual({
      text: '→ 4 B ← 1 B /min · dropped 4 B',
      tone: 'warning',
    });
  });
});

describe('IOBridgeApp dashboard', () => {
  const env = createTestEnv();

  afterEach(() => env.reset());
  after(() => env.dispose());

  async function startBridge() {
    const device1 = env.serve({ port: 4201 });
    const device2 = env.serve({ port: 4202 });
    const app = await env.start(IOBridgeApp, {
      components: {
        peer1: {
          use: TcpClientComponent,
          values: { host: 'device1.lab', port: 4201 },
        },
        peer2: {
          use: TcpClientComponent,
          values: { host: 'device2.lab', port: 4202 },
        },
      },
    });
    return {
      app,
      conn1: await device1.connection(),
      conn2: await device2.connection(),
    };
  }

  it('should show what it passed on, beside both peers', async () => {
    const { app, conn1, conn2 } = await startBridge();
    conn1.send('from 1');
    expect((await conn2.receive()).toString()).toBe('from 1');
    conn2.send('2');
    expect((await conn1.receive()).toString()).toBe('2');

    env.flushCounts(app);
    expect(env.dashboard(app, 'bridge/forwarded')).toMatchObject({
      series: {
        toPeer2: [[expect.any(Number), 'from 1'.length]],
        toPeer1: [[expect.any(Number), 1]],
      },
    });
    expect(env.dashboard(app, 'bridge/dropped')).toMatchObject({ value: 0 });
    /* The peers' own widgets, included */
    expect(env.dashboard(app, 'peer1/connection/link')).toMatchObject({
      value: { status: 'ok', text: 'Connected to device1.lab:4201' },
    });
    expect(env.dashboard(app, 'peer2/connection/received')).toMatchObject({
      value: 1,
    });
    expect(env.dashboardIssues(app)).toEqual({});
  });

  it('should show what it dropped and why', async () => {
    const { app, conn1, conn2 } = await startBridge();
    app.on('error', () => undefined);
    conn2.close();
    await env.waitForEvent(app.peer2, 'disconnect');
    conn1.send('lost');
    await env.waitForEvent(app, 'error');

    expect(env.dashboard(app, 'bridge/dropped')).toMatchObject({
      value: 'lost'.length,
    });
    expect(env.dashboard(app, 'bridge/lastError')).toMatchObject({
      value: {
        status: 'error',
        text: expect.stringMatching(/^Failed to write data to peer2: /),
      },
    });
  });
});
