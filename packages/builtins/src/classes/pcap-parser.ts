import { Buffer } from 'node:buffer';

/** One captured frame, as a pcap record holds it */
export interface PcapRecord {
  time: Date;
  /** The frame's bytes as captured: at most the snapshot length */
  data: Buffer;
  /** The frame's length on the wire, more than `data`'s when cut */
  originalLength: number;
  /** The capture's link type: 1 for Ethernet */
  linkType: number;
}

const GLOBAL_HEADER = 24;
const RECORD_HEADER = 16;
/* The magic numbers, as read big-endian: microseconds and nanoseconds,
 * each in the writer's byte order */
const MICRO = 0xa1b2c3d4;
const NANO = 0xa1b23c4d;
const MICRO_SWAPPED = 0xd4c3b2a1;
const NANO_SWAPPED = 0x4d3cb2a1;

/**
 * Reads a pcap stream - tcpdump's `-w -` - as it comes: chunks cut
 * anywhere, the global header first, then one record per frame. Plain
 * JavaScript, no native code.
 */
export class PcapParser {
  /** The capture's link type, once the global header is read */
  linkType?: number;
  /** The capture's snapshot length, once the global header is read */
  snapLength?: number;
  protected _pending: Buffer = Buffer.alloc(0);
  protected _littleEndian = false;
  protected _nano = false;

  /** The records the chunk completes; what is left waits for the next */
  push(chunk: Buffer): PcapRecord[] {
    this._pending = this._pending.length
      ? Buffer.concat([this._pending, chunk])
      : chunk;
    let offset = 0;
    if (this.linkType == null) {
      if (this._pending.length < GLOBAL_HEADER) return [];
      this._readGlobalHeader(this._pending);
      offset = GLOBAL_HEADER;
    }
    const records: PcapRecord[] = [];
    const buf = this._pending;
    while (buf.length - offset >= RECORD_HEADER) {
      const seconds = this._u32(buf, offset);
      const fraction = this._u32(buf, offset + 4);
      const captured = this._u32(buf, offset + 8);
      const original = this._u32(buf, offset + 12);
      /* A record longer than the snapshot length is a broken stream:
       * reading on would take garbage for frames */
      if (captured > Math.max(this.snapLength!, 262144))
        throw new Error(
          `pcap record of ${captured} bytes, over the snapshot length ${this.snapLength}`,
        );
      if (buf.length - offset - RECORD_HEADER < captured) break;
      const start = offset + RECORD_HEADER;
      records.push({
        time: new Date(
          seconds * 1000 + (this._nano ? fraction / 1e6 : fraction / 1e3),
        ),
        /* A copy: the pending buffer is dropped once read */
        data: Buffer.from(buf.subarray(start, start + captured)),
        originalLength: original,
        linkType: this.linkType!,
      });
      offset = start + captured;
    }
    this._pending = buf.subarray(offset);
    return records;
  }

  protected _readGlobalHeader(buf: Buffer): void {
    const magic = buf.readUInt32BE(0);
    if (magic === MICRO || magic === NANO) this._littleEndian = false;
    else if (magic === MICRO_SWAPPED || magic === NANO_SWAPPED)
      this._littleEndian = true;
    else
      throw new Error(
        `Not a pcap stream: magic number 0x${magic.toString(16).padStart(8, '0')}`,
      );
    this._nano = magic === NANO || magic === NANO_SWAPPED;
    this.snapLength = this._u32(buf, 16);
    /* The upper bits carry the FCS length in some writers */
    this.linkType = this._u32(buf, 20) & 0x0fffffff;
  }

  protected _u32(buf: Buffer, offset: number): number {
    return this._littleEndian
      ? buf.readUInt32LE(offset)
      : buf.readUInt32BE(offset);
  }
}
