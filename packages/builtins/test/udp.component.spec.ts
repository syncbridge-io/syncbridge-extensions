import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { expect } from 'expect';
import { UdpListenerComponent } from '../src/index.js';

async function until(condition: () => boolean, what: string) {
  const deadline = Date.now() + 3000;
  while (!condition() && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 5));
  if (!condition()) throw new Error(`Timed out waiting for ${what}`);
}

function create(values: Record<string, unknown>) {
  return new UdpListenerComponent({
    app: {} as any,
    parent: {} as any,
    name: 'udp',
    path: 'udp',
    values: { bindInterface: '127.0.0.1', ...values },
  });
}

describe('UdpListenerComponent', () => {
  let component: UdpListenerComponent;
  let sender: dgram.Socket;

  beforeEach(() => {
    sender = dgram.createSocket('udp4');
  });

  afterEach(async () => {
    sender.close();
    await component.stop();
  });

  it('should read the datagrams it is sent, from this machine too', async () => {
    component = create({ port: 0 });
    await component.init();
    const listening = new Promise<number>(resolve =>
      component.once('listening', resolve),
    );
    await component.start();
    const port = await listening;
    const received = new Promise<[Buffer, any]>(resolve =>
      component.once('data', (data, info) => resolve([data, info])),
    );
    sender.send('from here', port, '127.0.0.1');

    const [data, info] = await received;
    expect(String(data)).toBe('from here');
    expect(info.address).toBe('127.0.0.1');
    expect(String(info)).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  it('should tell each datagram as Packet Capture does, for a component taking either', async () => {
    component = create({ port: 0, bindInterface: '127.0.0.1' });
    await component.init();
    const listening = new Promise<number>(resolve =>
      component.once('listening', resolve),
    );
    await component.start();
    const port = await listening;
    const received = new Promise<any>(resolve =>
      component.once('datagram', resolve),
    );
    sender.send('as captured', port, '127.0.0.1');
    expect(await received).toEqual({
      time: expect.any(Date),
      srcIp: '127.0.0.1',
      srcPort: expect.any(Number),
      dstIp: '127.0.0.1',
      dstPort: port,
      payload: Buffer.from('as captured'),
    });
  });

  it('should be unhealthy, not crash, when its port is taken', async () => {
    const taken = dgram.createSocket('udp4');
    await new Promise<void>(resolve => taken.bind(0, '127.0.0.1', resolve));
    try {
      component = create({ port: (taken.address() as AddressInfo).port });
      await component.init();
      await component.start();
      await until(() => component.status === 'unhealthy', 'unhealthy');
      expect(component.statusMessage).toMatch(/EADDRINUSE/);
    } finally {
      taken.close();
    }
  });
});
