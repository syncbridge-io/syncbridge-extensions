import path from 'node:path';
import { createTestEnv } from '@syncbridge/testing';
import { expect } from 'expect';
import { HL7ReceiverApp } from './_fixtures/hl7-ext/src/index.js';

const FIXTURE = path.resolve(import.meta.dirname, '_fixtures/hl7-ext');

const ORU =
  'MSH|^~\\&|MONITOR|ICU|SB|HOSP|20261011120000||ORU^R01|MSG0001|P|2.5\r' +
  'PID|1||12345^^^HOSP^MR||DOE^JOHN';
const ADT =
  'MSH|^~\\&|REG|ER|SB|HOSP|20261011120100||ADT^A01|MSG0002|P|2.5\r' +
  'PID|1||12345^^^HOSP^MR||DOE^JOHN';

describe('HL7 dashboard', () => {
  const env = createTestEnv({ from: FIXTURE });

  afterEach(() => env.reset());
  after(() => env.dispose());

  it('should show the messages, their acknowledgments and their rate', async () => {
    const app = await env.start(HL7ReceiverApp, {
      components: { receiver: { values: { port: 2575 } } },
    });
    const conn = await env.connect(app, 'receiver', { framing: 'mllp' });
    expect((await conn.request(ORU)).toString()).toContain('MSA|AA|MSG0001');
    expect((await conn.request(ADT)).toString()).toContain('MSA|AR|MSG0002');

    /* An acknowledgment is listed as it is sent, its MSA-1 in its row */
    expect(env.dashboard(app, 'receiver/messages/last')).toMatchObject({
      kind: 'feed',
      rows: [
        {
          row: {
            direction: 'in',
            type: 'ORU^R01',
            controlId: 'MSG0001',
            ack: '',
            peer: expect.stringMatching(/127\.0\.0\.1/),
          },
        },
        { row: { direction: 'out', type: 'ACK^R01', ack: 'AA' } },
        { row: { direction: 'in', type: 'ADT^A01', controlId: 'MSG0002' } },
        { row: { direction: 'out', type: 'ACK^A01', ack: 'AR' } },
      ],
    });

    expect(env.dashboard(app, 'receiver/messages/types')).toMatchObject({
      rows: [
        { key: 'ORU^R01', row: { value: 1 } },
        { key: 'ADT^A01', row: { value: 1 } },
      ],
    });

    env.flushCounts(app);
    expect(env.dashboard(app, 'receiver/messages/rate')).toMatchObject({
      series: {
        received: [[expect.any(Number), 2]],
        sent: [[expect.any(Number), 2]],
      },
    });
    expect(env.dashboard(app, 'receiver/messages/errors')).toMatchObject({
      value: 0,
    });
    expect(env.dashboardIssues(app)).toEqual({});
  });

  it('should show where it listens, and its messages of the last minute', async () => {
    const app = await env.start(HL7ReceiverApp, {
      components: { receiver: { values: { port: 2575 } } },
    });
    expect(app.receiver.glance).toEqual({ text: '0.0.0.0:2575' });
    const conn = await env.connect(app, 'receiver', { framing: 'mllp' });
    await conn.request(ORU);
    await conn.request(ADT);
    /* The acknowledgments are counted, but the last is what was handled */
    expect(app.receiver.activity).toEqual({
      text: '1 client · ↓ 2 ↑ 2 msg/min · last ADT^A01',
    });
    app.receiver.emit('error', new Error('bad frame'));
    expect(app.receiver.activity).toEqual({
      text: '1 client · ↓ 2 ↑ 2 msg/min · last ADT^A01 · 1 error',
      tone: 'warning',
    });
  });
});
