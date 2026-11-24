# PacketCapture

`PacketCapture` reads the frames of a network interface, such as the port of
a switch that mirrors other ports' traffic. It tells each frame as it was
captured, and each UDP datagram a frame carries. Use it to listen to devices
that talk to someone else, such as patient monitors sending to their central
station, without sitting between them.

The worker holds no privilege. SyncBridge captures for it with `tcpdump`,
once an admin approved the interface and the filter, and hands the worker
the capture. The component reads it in plain JavaScript: no native code.

It extends [`IoClient`](../guides/io-client.md) of `@syncbridge/builtins`.
Its class is `PacketCaptureComponent`, its protocol is `pcap`. It declares
the worker permission `network:capture`.

## Settings

| Setting         | Example          | Meaning                                                                                   |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Interface       | `enp4s0f1`       | The interface to capture, picked from the server's interfaces. Not the `any` interface.  |
| Filter          | `udp port 24000` | A BPF filter, as `tcpdump` takes it. Empty captures every frame.                          |
| Promiscuous     | on               | Frames addressed to other machines too, as a mirror port carries them. Off: only its own. |
| Snapshot length | `65535`          | Bytes of each frame kept. A longer frame is cut, and its datagram is lost.                |

A change of any setting restarts the component. A changed interface or
filter has to be approved again.

## Approval

The capture starts only after an admin approves this interface and this
filter for the worker, on the worker's page. Until then the component is
`unhealthy` with the message `Waiting for an admin to approve capturing
<interface> (<filter>)`, and asks again every 10 seconds: it starts by itself
once approved.

The server needs `tcpdump` and the capabilities to capture. SyncBridge's
Linux package has both. In Docker, the container needs
`cap_add: [NET_RAW, NET_ADMIN]`: see SyncBridge's installation guide.

## Events

| Event        | Arguments            | Emitted                                                                   |
| ------------ | -------------------- | ------------------------------------------------------------------------- |
| `frame`      | `frame: Frame`       | A frame was captured.                                                     |
| `datagram`   | `datagram: Datagram` | A captured frame carried a whole UDP datagram.                            |
| `data`       | `data: Buffer, name` | The frame's bytes, with the interface's name, as every `IoClient` tells.  |
| `connect`    |                      | The capture started.                                                      |
| `disconnect` | `error?: Error`      | The capture ended: stopped, or with the error that ended it.              |

`Frame` is `{ time, data, linkType }`. `data` is the whole link-layer frame
as it was captured: on an Ethernet interface (`linkType` 1), the Ethernet II
header with both MAC addresses, and the 802.1Q tags kept. Another kind of
interface tells its own `linkType`, and its frames are not opened.

`Datagram` (from `@syncbridge/builtins`) is `{ time, srcIp, srcPort, dstIp,
dstPort, payload }`, the same as [`UdpListener`](../UdpListener/README.md)
emits: a component taking datagrams works with either. The component opens
Ethernet, one or two VLAN tags, IPv4, IPv6 and UDP. It leaves out what is not
a whole datagram: other protocols, IP fragments, and frames cut short by the
snapshot length.

## Communication log

The `communication` channel is off by default. It takes the events
`connect`, `disconnect`, `read` and `write`.

| When              | `direction` | `event`      | `data`         | `details`            |
| ----------------- | ----------- | ------------ | -------------- | -------------------- |
| capture starts    | `info`      | `connect`    |                | the interface's name |
| a frame arrives   | `in`        |              | the frame      | the interface's name |
| capture ends      | `info`      | `disconnect` |                | the interface's name |

## Dashboard

Its `capture` dashboard shows, where an app takes it: frames and UDP
datagrams a second, how many frames were cut short, and the last frame.
Its `connection` dashboard shows the capture's state and its bytes: see
[IoClient](../guides/io-client.md#dashboard).

## Status

| Status      | When                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| `started`   | The capture is running.                                                                  |
| `unhealthy` | Not approved yet, or the capture ended: it asks again every 10 seconds.                  |
| `unhealthy` | No such interface, a filter that does not compile, or a server that cannot capture: it waits for the settings to change. |
| `stopped`   | After a stop. The capture is closed.                                                     |

## Example

```ts
import { PacketCaptureComponent, type Datagram } from '@syncbridge/builtins';
import { App, AppBase } from '@syncbridge/common';

@App({ displayName: 'Monitor listener' })
export class MonitorListenerApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly mirror: PacketCaptureComponent;

  protected async _init(): Promise<void> {
    await super._init();
    this.mirror.on('datagram', (datagram: Datagram) => {
      this.logger?.info(
        `${datagram.srcIp}:${datagram.srcPort} sent ${datagram.payload.length} bytes`,
      );
    });
  }
}
```
