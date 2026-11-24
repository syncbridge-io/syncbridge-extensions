import { Buffer } from 'node:buffer';

/**
 * A UDP datagram, as UDP Listener and Packet Capture emit it (`datagram`):
 * a component taking one takes the other's unchanged
 */
export interface Datagram {
  time: Date;
  srcIp: string;
  srcPort: number;
  /** UDP Listener's: the address it listens on, which Node tells */
  dstIp: string;
  dstPort: number;
  payload: Buffer;
}

/** pcap's link types this opens; the others are left as frames */
export const LINKTYPE_ETHERNET = 1;
export const LINKTYPE_RAW = 101;

const ETHERTYPE_IPV4 = 0x0800;
const ETHERTYPE_IPV6 = 0x86dd;
/* 802.1Q, and 802.1ad's outer tag of a double-tagged frame */
const ETHERTYPE_VLAN = [0x8100, 0x88a8, 0x9100];
const PROTOCOL_UDP = 17;
/* IPv6 extension headers that may stand before UDP */
const IPV6_EXTENSIONS = new Set([0, 43, 60]);
const IPV6_FRAGMENT = 44;

/**
 * The UDP datagram a captured frame carries, or none: not UDP, a fragment
 * that is not the whole datagram, or a frame cut short of its payload
 */
export function datagramOf(
  frame: Buffer,
  linkType: number,
  time: Date,
): Datagram | undefined {
  let offset = 0;
  let ethertype: number;
  if (linkType === LINKTYPE_ETHERNET) {
    if (frame.length < 14) return;
    ethertype = frame.readUInt16BE(12);
    offset = 14;
    /* Tags kept by libpcap, one or two */
    while (ETHERTYPE_VLAN.includes(ethertype)) {
      if (frame.length < offset + 4) return;
      ethertype = frame.readUInt16BE(offset + 2);
      offset += 4;
    }
  } else if (linkType === LINKTYPE_RAW) {
    if (!frame.length) return;
    ethertype = frame[0] >> 4 === 6 ? ETHERTYPE_IPV6 : ETHERTYPE_IPV4;
  } else return;
  if (ethertype === ETHERTYPE_IPV4) return ipv4(frame, offset, time);
  if (ethertype === ETHERTYPE_IPV6) return ipv6(frame, offset, time);
}

function ipv4(frame: Buffer, at: number, time: Date): Datagram | undefined {
  if (frame.length < at + 20 || frame[at] >> 4 !== 4) return;
  const headerLength = (frame[at] & 0x0f) * 4;
  /* A fragment holds part of a datagram: more to come, or not the first */
  const flagsOffset = frame.readUInt16BE(at + 6);
  if (flagsOffset & 0x2000 || flagsOffset & 0x1fff) return;
  if (frame[at + 9] !== PROTOCOL_UDP) return;
  const srcIp = Array.from(frame.subarray(at + 12, at + 16)).join('.');
  const dstIp = Array.from(frame.subarray(at + 16, at + 20)).join('.');
  return udp(frame, at + headerLength, time, srcIp, dstIp);
}

function ipv6(frame: Buffer, at: number, time: Date): Datagram | undefined {
  if (frame.length < at + 40 || frame[at] >> 4 !== 6) return;
  const srcIp = ipv6Text(frame.subarray(at + 8, at + 24));
  const dstIp = ipv6Text(frame.subarray(at + 24, at + 40));
  let next = frame[at + 6];
  let offset = at + 40;
  while (next !== PROTOCOL_UDP) {
    if (next === IPV6_FRAGMENT) {
      if (frame.length < offset + 8) return;
      const fragment = frame.readUInt16BE(offset + 2);
      /* Only an unfragmented datagram, marked as fragment 0 of none more */
      if (fragment & 0xfff9) return;
      next = frame[offset];
      offset += 8;
    } else if (IPV6_EXTENSIONS.has(next)) {
      if (frame.length < offset + 2) return;
      const length = (frame[offset + 1] + 1) * 8;
      next = frame[offset];
      offset += length;
    } else return;
  }
  return udp(frame, offset, time, srcIp, dstIp);
}

function udp(
  frame: Buffer,
  at: number,
  time: Date,
  srcIp: string,
  dstIp: string,
): Datagram | undefined {
  if (frame.length < at + 8) return;
  const length = frame.readUInt16BE(at + 4);
  /* Cut by the snapshot length: a payload short of what UDP says */
  if (length < 8 || frame.length < at + length) return;
  return {
    time,
    srcIp,
    srcPort: frame.readUInt16BE(at),
    dstIp,
    dstPort: frame.readUInt16BE(at + 2),
    payload: Buffer.from(frame.subarray(at + 8, at + length)),
  };
}

/** An IPv6 address as it is written: the longest run of zeros as `::` */
function ipv6Text(bytes: Buffer): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i));
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength && j - i > 1) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map(g => g.toString(16));
  if (bestStart < 0) return hex.join(':');
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}
