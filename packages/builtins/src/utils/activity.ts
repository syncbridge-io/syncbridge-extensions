import type { Runnable } from '@syncbridge/common';
import { ServiceStatus } from '@syncbridge/common';

/**
 * A count over the last minute, the "/min" of an activity line: sixty
 * one-second slots, each emptied as its second comes round again
 */
export class PerMinute {
  protected _slots = new Array<number>(60).fill(0);
  protected _second = 0;

  /** @param now The clock, in milliseconds; a test gives its own */
  constructor(protected readonly _now: () => number = Date.now) {}

  /** What happened in the last sixty seconds */
  get value(): number {
    this._roll();
    let sum = 0;
    for (const n of this._slots) sum += n;
    return sum;
  }

  add(n = 1): void {
    this._roll();
    this._slots[this._second % 60] += n;
  }

  clear(): void {
    this._slots.fill(0);
  }

  /** Empties the slots of the seconds gone by since the last call */
  protected _roll(): void {
    const second = Math.floor(this._now() / 1000);
    if (second - this._second >= 60) this._slots.fill(0);
    else
      for (let s = this._second + 1; s <= second; s++) this._slots[s % 60] = 0;
    this._second = Math.max(second, this._second);
  }
}

/**
 * Calls `renew` as the element starts and once a second while it runs, and
 * `stopped` when it stops. A rate per minute on its activity line is so
 * renewed, and falls when nothing happens; a stopped element shows none.
 */
export function renewWhileRunning(
  element: Runnable<any>,
  renew: () => void,
  stopped?: () => void,
): void {
  let timer: NodeJS.Timeout | undefined;
  element.on('status-change', (status: ServiceStatus) => {
    const running =
      status !== ServiceStatus.stopped && status !== ServiceStatus.invalid;
    if (running && !timer) {
      renew();
      timer = setInterval(renew, 1000);
      /* It keeps no worker alive */
      timer.unref();
    } else if (!running && timer) {
      clearInterval(timer);
      timer = undefined;
      stopped?.();
    }
  });
}

/** Bytes as an activity line writes them: `512 B`, `1.2 KB`, `34 MB` */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit && value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** A count as an activity line writes it: `950`, `12.3k`, `4.1M` */
export function formatCount(count: number): string {
  if (count < 10_000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
