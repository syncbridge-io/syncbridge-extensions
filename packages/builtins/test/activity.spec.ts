import { expect } from 'expect';
import { formatBytes, formatCount, PerMinute } from '../src/index.js';

describe('PerMinute', () => {
  it('should count what happened in the last sixty seconds alone', () => {
    let now = 1_000_000;
    const rate = new PerMinute(() => now);
    rate.add(5);
    now += 30_000;
    rate.add(2);
    expect(rate.value).toBe(7);
    now += 30_500;
    expect(rate.value).toBe(2);
    now += 30_000;
    expect(rate.value).toBe(0);
  });

  it('should forget everything after a minute of silence', () => {
    let now = 0;
    const rate = new PerMinute(() => now);
    rate.add(3);
    now += 3_600_000;
    rate.add();
    expect(rate.value).toBe(1);
  });

  it('should start again when cleared', () => {
    const rate = new PerMinute();
    rate.add(4);
    rate.clear();
    expect(rate.value).toBe(0);
  });
});

describe('formatBytes and formatCount', () => {
  it('should write bytes in the unit that fits', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1229)).toBe('1.2 KB');
    expect(formatBytes(34 * 1024 * 1024)).toBe('34 MB');
  });

  it('should write large counts short', () => {
    expect(formatCount(950)).toBe('950');
    expect(formatCount(12_345)).toBe('12.3k');
    expect(formatCount(4_100_000)).toBe('4.1M');
  });
});
