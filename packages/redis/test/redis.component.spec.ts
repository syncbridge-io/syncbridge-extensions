import { expect } from 'expect';
import { RedisComponent } from '../src/components/redis.component.js';

describe('RedisComponent', () => {
  it('should write its connection to Redis to its channel', async () => {
    const component: any = Object.create(RedisComponent.prototype);
    component.values = {};
    component.components = {};
    component._context = { status: 'stopped' };
    const records: any[] = [];
    component.communicationLog = { write: (r: any) => records.push(r) };
    await component._init();
    component.emit('connect');
    component.emit('disconnect', new Error('reset'));
    component.emit('reconnecting');
    expect(records.map(r => [r.event, r.message])).toEqual([
      ['connect', 'Connected'],
      ['disconnect', 'Disconnected: reset'],
      ['reconnecting', 'Connecting again'],
    ]);
  });
});
