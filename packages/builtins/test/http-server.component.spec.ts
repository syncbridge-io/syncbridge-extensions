import net from 'node:net';
import { expect } from 'expect';
import { HttpServerComponent } from '../src/index.js';

describe('HttpServerComponent', () => {
  it('should write the requests it is sent and what it answers to its channel', async () => {
    /* The component without an app: _init and _start read `values` alone */
    const component: any = Object.create(HttpServerComponent.prototype);
    component.values = { port: 0 };
    component.components = {};
    /* Its state as the engine keeps it; _start called alone leaves it stopped */
    component._context = { status: 'stopped' };
    const records: any[] = [];
    component.communicationLog = { write: (r: any) => records.push(r) };
    await component._init();
    component.server.on('request', (_req: any, res: any) => {
      res.statusCode = 201;
      res.end('made');
    });
    await component._start(new AbortController().signal);
    try {
      const { port } = component.server.address() as net.AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/orders?id=1`, {
        method: 'POST',
        body: 'secret body',
      });
      expect(await res.text()).toBe('made');
      await new Promise(resolve => setTimeout(resolve, 20));
      /* The bodies are not written */
      expect(records.map(r => [r.event, r.direction, r.message])).toEqual([
        ['request', 'in', 'POST /orders?id=1'],
        [
          'response',
          'out',
          expect.stringMatching(/^201 POST \/orders\?id=1 \(\d+ ms\)$/),
        ],
      ]);
      expect(records[0].details).toMatch(/127\.0\.0\.1:\d+$/);
    } finally {
      await component._stop();
    }
  });
});
