import net from 'node:net';
import tls from 'node:tls';
import { expect } from 'expect';
import { TcpServerComponent } from '../src/index.js';

/** The component without an app: _init and _start read `values` alone */
function createServer(values: Partial<TcpServerComponent.Variables>) {
  const component: any = Object.create(TcpServerComponent.prototype);
  component.values = { port: 0, ...values };
  component.components = {};
  /* Its state as the engine keeps it; _start called alone leaves it stopped */
  component._context = { status: 'stopped' };
  return component;
}

describe('TcpServerComponent', () => {
  it('should listen for plain TCP when TLS is disabled', async () => {
    const component = createServer({ tls_enabled: false });
    await component._init();
    expect(component.server).not.toBeInstanceOf(tls.Server);
    await component._start(new AbortController().signal);
    try {
      const received = new Promise<string>(resolve =>
        component.server.once('connection', (socket: net.Socket) =>
          socket.once('data', data => resolve(data.toString())),
        ),
      );
      const { port } = component.server.address() as net.AddressInfo;
      const client = net.connect(port, '127.0.0.1', () => client.write('ping'));
      expect(await received).toBe('ping');
      client.destroy();
    } finally {
      await component._stop();
    }
  });

  it('should stop while a client stays connected', async () => {
    const component = createServer({ tls_enabled: false });
    await component._init();
    await component._start(new AbortController().signal);
    const { port } = component.server.address() as net.AddressInfo;
    const client = net.connect(port, '127.0.0.1');
    await new Promise(resolve => client.once('connect', resolve));
    await component._stop();
    expect(component.server.listening).toBe(false);
    client.destroy();
  });

  it('should write what its connections read and write to its channel', async () => {
    const component = createServer({ tls_enabled: false });
    const records: any[] = [];
    component.communicationLog = { write: (r: any) => records.push(r) };
    await component._init();
    await component._start(new AbortController().signal);
    try {
      /* The code using the server reads late: nothing is lost to it */
      const answered = new Promise<void>(resolve =>
        component.server.once('connection', (socket: net.Socket) =>
          setTimeout(
            () =>
              socket.once('data', data => {
                socket.write('pong:' + data);
                socket.end('bye', resolve);
              }),
            50,
          ),
        ),
      );
      const { port } = component.server.address() as net.AddressInfo;
      const client = net.connect(port, '127.0.0.1', () => client.write('ping'));
      const reply = new Promise<string>(resolve => {
        let text = '';
        client.on('data', d => (text += d)).on('end', () => resolve(text));
      });
      await answered;
      expect(await reply).toBe('pong:pingbye');
      client.destroy();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(
        records.map(r => [r.direction, r.message ?? String(r.data)]),
      ).toEqual([
        ['info', 'Connected'],
        ['in', 'ping'],
        ['out', 'pong:ping'],
        ['out', 'bye'],
        ['info', 'Disconnected'],
      ]);
      expect(records[0].details).toMatch(/^(::ffff:)?127\.0\.0\.1:\d+$/);
    } finally {
      await component._stop();
    }
  });

  it('should create a TLS server when TLS is enabled', async () => {
    const component = createServer({ tls_enabled: true });
    await component._init();
    expect(component.server).toBeInstanceOf(tls.Server);
  });
});
