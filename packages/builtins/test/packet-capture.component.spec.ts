import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  type LogChannel,
  PacketCaptureError,
  type PacketCaptureRequest,
  SbError,
  ServiceStatus,
} from '@syncbridge/common';
import { expect } from 'expect';
import { type Datagram, PacketCaptureComponent } from '../src/index.js';

/* tcpdump's capture of two datagrams to port 24000 on Linux's loopback */
const LOOPBACK = fs.readFileSync(
  path.join(import.meta.dirname, '_fixtures/pcap/loopback-udp.pcap'),
);

/** SyncBridge's capture, played: each request answered in turn */
function fakeCapture(...answers: (PassThrough | Error)[]) {
  const requests: PacketCaptureRequest[] = [];
  const open = async (request: PacketCaptureRequest) => {
    requests.push(request);
    const answer = answers.shift() ?? new PassThrough();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { open, requests };
}

function refusal(code: PacketCaptureError) {
  return new SbError('refused', { code });
}

function create(
  packetCapture: ((r: PacketCaptureRequest) => Promise<any>) | undefined,
  values: object = {},
) {
  const component = new PacketCaptureComponent({
    app: { packetCapture } as any,
    parent: {} as any,
    name: 'mirror',
    path: 'mirror',
    values: {
      interface: 'enp4s0f1',
      filter: 'udp port 24000',
      promiscuous: true,
      snapLength: 65535,
      ...values,
    },
  });
  const records: LogChannel.Record[] = [];
  Object.defineProperty(component, 'communicationLog', {
    value: { write: (r: LogChannel.Record) => records.push(r) },
  });
  (component as any)._retryMs = 20;
  return { component, records };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

describe('PacketCaptureComponent', () => {
  let component: PacketCaptureComponent;

  afterEach(async () => {
    await component?.stop();
  });

  it('should ask for the interface and filter, and tell each frame and datagram', async () => {
    const stream = new PassThrough();
    const capture = fakeCapture(stream);
    ({ component } = create(capture.open));
    const frames: PacketCaptureComponent.Frame[] = [];
    const datagrams: Datagram[] = [];
    component.on('frame', frame => frames.push(frame));
    component.on('datagram', datagram => datagrams.push(datagram));
    await component.start();

    expect(capture.requests).toEqual([
      {
        interface: 'enp4s0f1',
        filter: 'udp port 24000',
        promiscuous: true,
        snapLength: 65535,
      },
    ]);
    expect(component.status).toBe(ServiceStatus.started);
    /* Cut anywhere, as a pipe hands it over */
    stream.write(LOOPBACK.subarray(0, 30));
    stream.write(LOOPBACK.subarray(30));
    await settle();

    expect(frames.map(f => [f.linkType, f.data.length])).toEqual([
      [1, 50],
      [1, 70],
    ]);
    expect(datagrams.map(d => [d.srcIp, d.dstPort, String(d.payload)])).toEqual(
      [
        ['127.0.0.1', 24000, 'hello v4'],
        ['::1', 24000, 'hello v6'],
      ],
    );
    expect(component.glance).toEqual({ text: 'enp4s0f1 · udp port 24000' });
    expect(component.activity).toEqual({
      text: '2 frames/min · 2 datagrams/min',
    });
  });

  it('should write its frames to the communication channel', async () => {
    const stream = new PassThrough();
    const capture = fakeCapture(stream);
    let records: LogChannel.Record[];
    ({ component, records } = create(capture.open));
    await component.start();
    stream.write(LOOPBACK);
    await settle();
    expect(records.map(r => [r.direction, r.event, r.details])).toEqual([
      ['info', 'connect', 'enp4s0f1'],
      ['in', undefined, 'enp4s0f1'],
      ['in', undefined, 'enp4s0f1'],
    ]);
  });

  it('should wait for an admin to approve, and capture once approved', async () => {
    const stream = new PassThrough();
    const capture = fakeCapture(
      refusal(PacketCaptureError.NotApproved),
      stream,
    );
    ({ component } = create(capture.open));
    await component.start();
    expect(component.status).toBe(ServiceStatus.unhealthy);
    expect(component.statusMessage).toBe(
      'Waiting for an admin to approve capturing enp4s0f1 (udp port 24000)',
    );
    await once(component, 'connect');
    expect(component.status).toBe(ServiceStatus.started);
    expect(capture.requests.length).toBe(2);
  });

  it('should not ask again for what an admin cannot approve', async () => {
    const capture = fakeCapture(refusal(PacketCaptureError.NoSuchInterface));
    ({ component } = create(capture.open));
    await component.start();
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(component.statusMessage).toBe(
      'This server has no network interface "enp4s0f1"',
    );
    expect(capture.requests.length).toBe(1);
  });

  it('should be unhealthy when the capture ends, and capture again', async () => {
    const first = new PassThrough();
    const second = new PassThrough();
    const capture = fakeCapture(first, second);
    ({ component } = create(capture.open));
    await component.start();
    const disconnected = once(component, 'disconnect');
    first.destroy();
    const [error] = await disconnected;
    expect(error.message).toBe('The capture ended');
    expect(component.status).toBe(ServiceStatus.unhealthy);
    await once(component, 'connect');
    expect(component.status).toBe(ServiceStatus.started);
  });

  it('should stop the capture when stopped', async () => {
    const stream = new PassThrough();
    ({ component } = create(fakeCapture(stream).open));
    await component.start();
    await component.stop();
    expect(stream.destroyed).toBe(true);
    expect(component.activity).toBeUndefined();
  });

  it('should tell an engine that cannot capture', async () => {
    ({ component } = create(undefined));
    await component.start();
    expect(component.status).toBe(ServiceStatus.unhealthy);
    expect(component.statusMessage).toMatch(/cannot capture packets/);
  });

  it('should tell a stream that is not pcap, and capture again', async () => {
    const first = new PassThrough();
    const capture = fakeCapture(first, new PassThrough());
    ({ component } = create(capture.open));
    await component.start();
    const disconnected = once(component, 'disconnect');
    first.write(Buffer.alloc(24, 7));
    const [error] = await disconnected;
    expect(error.message).toMatch(/Not a pcap stream/);
    await once(component, 'connect');
  });
});
