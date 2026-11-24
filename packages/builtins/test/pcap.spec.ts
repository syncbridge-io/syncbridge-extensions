import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'expect';
import {
  datagramOf,
  LINKTYPE_ETHERNET,
  LINKTYPE_RAW,
  PcapParser,
} from '../src/index.js';

/* Recorded with tcpdump on Linux's loopback (Ethernet, zero MACs): one
 * IPv4 and one IPv6 datagram to port 24000, "hello v4" and "hello v6" */
const LOOPBACK = fs.readFileSync(
  path.join(import.meta.dirname, '_fixtures/pcap/loopback-udp.pcap'),
);

/** A pcap stream of the frames, written as the options say */
function pcap(
  frames: Buffer[],
  options: { littleEndian?: boolean; nano?: boolean; linkType?: number } = {},
): Buffer {
  const le = options.littleEndian ?? true;
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    if (le) b.writeUInt32LE(n);
    else b.writeUInt32BE(n);
    return b;
  };
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    if (le) b.writeUInt16LE(n);
    else b.writeUInt16BE(n);
    return b;
  };
  const parts: Buffer[] = [
    u32(options.nano ? 0xa1b23c4d : 0xa1b2c3d4),
    u16(2),
    u16(4),
    u32(0),
    u32(0),
    u32(65535),
    u32(options.linkType ?? LINKTYPE_ETHERNET),
  ];
  frames.forEach((frame, i) => {
    parts.push(
      u32(1700000000 + i),
      u32(options.nano ? 500_000_000 : 500_000),
      u32(frame.length),
      u32(frame.length),
      frame,
    );
  });
  return Buffer.concat(parts);
}

/** An IPv4 UDP packet, its checksums left zero */
function ipv4Udp(
  payload: string,
  opts: { flags?: number; protocol?: number } = {},
): Buffer {
  const data = Buffer.from(payload);
  const udp = Buffer.alloc(8);
  udp.writeUInt16BE(40000, 0);
  udp.writeUInt16BE(24000, 2);
  udp.writeUInt16BE(8 + data.length, 4);
  const ip = Buffer.alloc(20);
  ip[0] = 0x45;
  ip.writeUInt16BE(20 + 8 + data.length, 2);
  ip.writeUInt16BE(opts.flags ?? 0x4000, 6);
  ip[8] = 64;
  ip[9] = opts.protocol ?? 17;
  Buffer.from([10, 0, 0, 5]).copy(ip, 12);
  Buffer.from([10, 0, 0, 9]).copy(ip, 16);
  return Buffer.concat([ip, udp, data]);
}

/** An Ethernet frame around a packet; with two VLANs, an 802.1ad outer tag */
function ethernet(packet: Buffer, ethertype = 0x0800, vlans: number[] = []) {
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
  };
  const parts: Buffer[] = [Buffer.alloc(12, 0xaa)];
  vlans.forEach((id, i) => {
    parts.push(u16(i === 0 && vlans.length > 1 ? 0x88a8 : 0x8100), u16(id));
  });
  parts.push(u16(ethertype), packet);
  return Buffer.concat(parts);
}

describe('PcapParser', () => {
  it("should read tcpdump's records, whatever the chunks", () => {
    const whole = new PcapParser().push(LOOPBACK);
    expect(whole.map(r => [r.linkType, r.data.length])).toEqual([
      [LINKTYPE_ETHERNET, 50],
      [LINKTYPE_ETHERNET, 70],
    ]);
    /* One byte at a time: the header and the records cut anywhere */
    const parser = new PcapParser();
    const byByte = [...LOOPBACK].flatMap(b => parser.push(Buffer.from([b])));
    expect(byByte.map(r => r.data)).toEqual(whole.map(r => r.data));
    expect(parser.snapLength).toBe(65535);
  });

  it('should read both byte orders and both time precisions', () => {
    const frame = ethernet(ipv4Udp('x'));
    for (const littleEndian of [true, false])
      for (const nano of [false, true]) {
        const [record] = new PcapParser().push(
          pcap([frame], { littleEndian, nano }),
        );
        expect(record.data).toEqual(frame);
        expect(record.time.getTime()).toBe(1700000000500);
      }
  });

  it('should refuse a stream that is not pcap', () => {
    expect(() => new PcapParser().push(Buffer.alloc(24, 1))).toThrow(
      'Not a pcap stream',
    );
  });
});

describe('datagramOf', () => {
  const time = new Date(0);

  it('should open the IPv4 and IPv6 datagrams tcpdump recorded', () => {
    const records = new PcapParser().push(LOOPBACK);
    const datagrams = records.map(r => datagramOf(r.data, r.linkType, r.time));
    expect(datagrams).toEqual([
      expect.objectContaining({
        srcIp: '127.0.0.1',
        dstIp: '127.0.0.1',
        dstPort: 24000,
        payload: Buffer.from('hello v4'),
      }),
      expect.objectContaining({
        srcIp: '::1',
        dstIp: '::1',
        dstPort: 24000,
        payload: Buffer.from('hello v6'),
      }),
    ]);
    expect(datagrams[0]!.time).toBe(records[0].time);
  });

  it('should open a datagram behind one or two VLAN tags', () => {
    for (const vlans of [[10], [100, 10]]) {
      const frame = ethernet(ipv4Udp('tagged'), 0x0800, vlans);
      expect(datagramOf(frame, LINKTYPE_ETHERNET, time)).toEqual({
        time,
        srcIp: '10.0.0.5',
        srcPort: 40000,
        dstIp: '10.0.0.9',
        dstPort: 24000,
        payload: Buffer.from('tagged'),
      });
    }
  });

  it('should open a raw IP capture', () => {
    expect(datagramOf(ipv4Udp('raw'), LINKTYPE_RAW, time)?.payload).toEqual(
      Buffer.from('raw'),
    );
  });

  it('should leave what is not a whole UDP datagram', () => {
    /* TCP; a first fragment; a later fragment; another link type */
    expect(
      datagramOf(ethernet(ipv4Udp('t', { protocol: 6 })), 1, time),
    ).toBeUndefined();
    expect(
      datagramOf(ethernet(ipv4Udp('f', { flags: 0x2000 })), 1, time),
    ).toBeUndefined();
    expect(
      datagramOf(ethernet(ipv4Udp('f', { flags: 0x0010 })), 1, time),
    ).toBeUndefined();
    expect(datagramOf(ipv4Udp('x'), 113, time)).toBeUndefined();
    /* Cut by the snapshot length before its payload ends */
    const cut = ethernet(ipv4Udp('cut short'));
    expect(
      datagramOf(cut.subarray(0, cut.length - 3), 1, time),
    ).toBeUndefined();
  });
});
