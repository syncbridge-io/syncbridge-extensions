import { formatCount } from '@syncbridge/builtins';
import type { Widget } from '@syncbridge/common';

/** A Kafka client's glance: its first broker, how many more, its topics */
export function kafkaGlance(
  brokers: string[] | undefined,
  topics?: string[],
): string | undefined {
  if (!brokers?.length) return;
  let out = brokers[0];
  if (brokers.length > 1) out += ` +${brokers.length - 1}`;
  if (topics?.length) out += ` · ${topics.join(', ')}`;
  return out;
}

/**
 * A Kafka client's activity: its messages of the last minute, and what
 * failed in it, in warning
 */
export function kafkaActivity(
  messages: number,
  failed: number,
  failedWord: string,
): [text: string, tone?: Widget.Tone] {
  const text = `${formatCount(messages)} msg/min`;
  return failed
    ? [`${text} · ${formatCount(failed)} ${failedWord}`, 'warning']
    : [text];
}
