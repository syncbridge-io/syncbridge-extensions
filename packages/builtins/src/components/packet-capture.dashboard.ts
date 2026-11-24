import { DashboardBase, Widget } from '@syncbridge/common';

/** A capture at a glance: its frames, its datagrams, what was cut */
export class PacketCaptureDashboard extends DashboardBase {
  /** Counted in the worker: one point a second is sent, however busy */
  @Widget.Chart({
    title: 'Frames',
    series: ['frames', 'datagrams'],
    labels: { frames: 'Frames', datagrams: 'UDP datagrams' },
    unit: '/s',
    size: { width: 2 },
  })
  declare readonly rate: Widget.Chart;

  /** Frames longer than the snapshot length: their datagrams are lost */
  @Widget.Stat({ title: 'Cut short' })
  declare readonly truncated: Widget.Stat;

  @Widget.Status({ title: 'Last frame' })
  declare readonly lastFrame: Widget.Status;
}
