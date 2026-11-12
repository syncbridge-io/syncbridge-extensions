import { once } from 'node:events';
import path from 'node:path';
import { ServiceStatus } from '@syncbridge/common';
import { createTestEnv } from '@syncbridge/testing';
import { expect } from 'expect';
import { SerialEchoApp } from './_fixtures/serial-ext/src/index.js';

const FIXTURE = path.resolve(import.meta.dirname, '_fixtures/serial-ext');
const PORT = '/dev/ttyVSB0';

describe('virtual serial port', () => {
  const env = createTestEnv({ from: FIXTURE });

  afterEach(() => env.reset());
  after(() => env.dispose());

  const start = () =>
    env.start(SerialEchoApp, {
      components: {
        line: {
          values: {
            port: PORT,
            reconnect: { initialDelay: 50, maxDelay: 200 },
          },
        },
      },
    });

  it('should connect a serial component to the device the test plays', async () => {
    const device = env.serialPort(PORT);
    const app = await start();
    expect(app.line.status).toBe(ServiceStatus.started);

    const conn = await device.connection();
    expect((await conn.request('ping')).toString()).toBe('PING');
    expect(app.received).toEqual(['ping']);
    expect(app.line.activity).toEqual({ text: '↓ 4 B ↑ 4 B /min' });
  });

  it('should frame messages as asked', async () => {
    const device = env.serialPort(PORT, {
      framing: { start: '\x02', end: '\x03' },
    });
    await start();
    const conn = await device.connection();
    const answer = await conn.request('abc');
    expect(answer.toString()).toBe('ABC');
  });

  it('should show a device that goes away as a disconnect, and reconnect', async () => {
    const device = env.serialPort(PORT);
    const app = await start();
    const events: string[] = [];
    app.line.on('disconnect', () => events.push('disconnect'));
    app.line.on('reconnect', () => events.push('reconnect'));
    const first = await device.connection();
    await first.close();
    await env.waitFor(app.line, ServiceStatus.unhealthy);
    /* The component opens the port again */
    await env.waitFor(app.line, ServiceStatus.started);
    expect(device.connections).toHaveLength(2);
    expect(events).toEqual(['disconnect', 'reconnect']);
    const second = device.connections[1];
    expect((await second.request('again')).toString()).toBe('AGAIN');
  });

  it('should stop cleanly while connected', async () => {
    const device = env.serialPort(PORT);
    const app = await start();
    const conn = await device.connection();
    await app.stop();
    expect(app.line.status).toBe(ServiceStatus.stopped);
    expect(app.line.statusMessage || '').toBe('');
    /* The device sees its port closed */
    if (!conn.closed) await once(conn.socket, 'close');
    expect(conn.closed).toBe(true);
  });

  it('should open the port with the settings of the profile', async () => {
    env.serialPort(PORT);
    const app = await env.start(SerialEchoApp, {
      components: {
        line: {
          values: { port: PORT, baudRate: 19200, dataBits: '7', stopBits: '2' },
        },
      },
    });
    expect(app.line.glance).toEqual({ text: `${PORT} 19200 7N2` });
    const settings = (app.line as any)._serialPort.settings;
    expect(settings).toMatchObject({
      baudRate: 19200,
      dataBits: 7,
      stopBits: 2,
    });
  });

  it('should accept a port that is not there yet, and keep trying it', async () => {
    /* Not listed when the extension read the ports: a device to be plugged
     * in later. The profile is valid; the component retries the port */
    const app = await env.create(SerialEchoApp, {
      components: {
        line: {
          values: {
            port: '/dev/ttyNOTHERE9',
            reconnect: { initialDelay: 50, maxDelay: 200 },
          },
        },
      },
    });
    await app.start();
    await env.waitFor(app.line, ServiceStatus.unhealthy);
    expect(app.line.status).toBe(ServiceStatus.unhealthy);
  });

  it('should list the virtual port among the serial ports', async () => {
    env.serialPort(PORT);
    const app = await start();
    const ports = await app.line.list();
    expect(ports.map(p => p.path)).toContain(PORT);
  });
});
