import { App, AppBase, UseDashboard } from '@syncbridge/common';
import { IoClientBaseComponent } from '../components.js';
import {
  formatBytes,
  PerMinute,
  renewWhileRunning,
} from '../utils/activity.js';
import { IOBridgeDashboard } from './io-bridge.dashboard.js';

@App({
  className: 'IOBridge',
  formerly: 'IOBridgeApp',
  displayName: 'IO Bridge',
  description: 'Create a bridge between two IO peers',
  summary:
    'Connects two IO peers: what one reads, it writes to the other, for example a serial port to a TCP socket.',
  tags: ['io', 'bridge'],
})
export class IOBridgeApp extends AppBase {
  @App.UseComponent({
    required: true,
  })
  declare readonly peer1: IoClientBaseComponent;

  @App.UseComponent({
    required: true,
  })
  declare readonly peer2: IoClientBaseComponent;

  /** What it passed on and dropped, beside each peer's own widgets */
  @UseDashboard({
    title: 'Bridge',
    include: [
      { component: 'peer1', section: 'peer1' },
      { component: 'peer2', section: 'peer2' },
    ],
  })
  declare readonly bridge: IOBridgeDashboard;

  protected _dropped!: number;
  /* Bytes passed on in the last minute, each way: its activity line */
  protected _perMinute!: Record<'peer1' | 'peer2', PerMinute>;

  protected async _init(): Promise<void> {
    await super._init();
    this._dropped = 0;
    this._perMinute = { peer1: new PerMinute(), peer2: new PerMinute() };
    renewWhileRunning(
      this,
      () => this._renewActivity(),
      () => {
        this.setActivity(undefined);
        this._perMinute.peer1.clear();
        this._perMinute.peer2.clear();
      },
    );
    /* Its glance is its peers' own, side by side */
    this._renewGlance();
    this.on('component-line-change', (_component, kind) => {
      if (kind === 'glance') this._renewGlance();
    });
    this.bridge?.dropped.set(0);
    this.bridge?.lastError.set('ok', 'No errors');
    this.peer1.on('data', (data: Buffer) => this._pass(data, 'peer2'));
    this.peer2.on('data', (data: Buffer) => this._pass(data, 'peer1'));
  }

  protected _pass(data: Buffer, to: 'peer1' | 'peer2') {
    try {
      this[to].write(data);
      this.bridge?.forwarded.count(
        to === 'peer2' ? 'toPeer2' : 'toPeer1',
        data.length,
      );
      this._perMinute[to].add(data.length);
      this._renewActivity();
    } catch (err: any) {
      err.message = `Failed to write data to ${to}: ${err.message}`;
      this._dropped += data.length;
      this.bridge?.dropped.set(this._dropped);
      this.bridge?.lastError.set('error', err.message);
      this._renewActivity();
      this.emit('error', err);
    }
  }

  protected _renewGlance(): void {
    const of = (peer: IoClientBaseComponent) => peer.glance?.text ?? peer.name;
    this.setGlance(`${of(this.peer1)} ↔ ${of(this.peer2)}`);
  }

  /** What it passed on in the last minute, and what it dropped in all */
  protected _renewActivity(): void {
    if (this.stopped) return;
    this.setActivity(
      `→ ${formatBytes(this._perMinute.peer2.value)} ` +
        `← ${formatBytes(this._perMinute.peer1.value)} /min` +
        (this._dropped ? ` · dropped ${formatBytes(this._dropped)}` : ''),
      this._dropped ? 'warning' : undefined,
    );
  }
}
