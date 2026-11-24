# UdpListener

`UdpListener` binds a UDP port and emits every datagram that arrives there.
It can enable broadcast and join multicast groups. Use it for devices that
announce themselves or send readings to a port, such as discovery
broadcasts and multicast feeds. To send to a fixed target, use
[`UdpClient`](../UdpClient/README.md).

It extends
[`IoClient`](../guides/io-client.md)
of `@syncbridge/builtins`. Its class is `UdpListenerComponent`, its
protocol is `udp`.

## Changing settings

A change of any setting restarts the component.

## Events

| Event       | Arguments                      | Emitted                                                             |
| ----------- | ------------------------------ | ------------------------------------------------------------------- |
| `listening` | `port: number`                 | The socket is bound.                                                |
| `data`      | `data: Buffer, info`           | A datagram arrived. `info` has `address`, `port`, `family`, `size`. |
| `datagram`  | `datagram: Datagram`           | The same datagram, as Packet Capture tells a captured one.          |
| `transmit`  | `data: string \| Buffer, info` | `write()` sent a datagram. `info` has `address`, `port`, `size`.    |
| `error`     | `error: Error`                 | The socket reported an error, such as a failed bind.                |

`info` of `data` and `transmit` has a `toString()` that returns
`address:port`.

`Datagram` (from `@syncbridge/builtins`) is `{ time, srcIp, srcPort, dstIp,
dstPort, payload }`: a component that takes it works with UDP Listener and
Packet Capture alike. Node does not tell a datagram's destination, so `dstIp`
is the address the listener binds, `0.0.0.0` when it listens on every
interface.

The component also emits `error` when the socket reports an error, such as a
failed bind (`EADDRINUSE`) or a failure to join a multicast group. It never
emits `connect` or `disconnect`.

Datagrams from any address, `127.0.0.1` included, are emitted as `data`.

## Methods

### `write(data: string | Buffer, port?: number, host?: string): void`

Sends a datagram from the listening socket, for example an answer to the
sender of a `data` event. `host` is required: the method throws
`You must provide the "host" argument to send a message over UDP socket` without
it. `port` defaults to the setting `port`. It emits `transmit` after the
send call.

## Communication log

The `communication` channel is off by default. It takes the events
`connect`, `disconnect`, `read` and `write`.

| When             | `direction` | `event` | `data`   | `details`                    |
| ---------------- | ----------- | ------- | -------- | ---------------------------- |
| datagram arrives | `in`        | `read`  | the data | `address:port` of the sender |
| `write()` sends  | `out`       | `write` | the data | `address:port` of the target |

The component writes no `connect` or `disconnect` records.

## Dashboard

Its `connection` dashboard shows `Listening on port <port>` once the socket is bound, the bytes received and sent, and a chart of bytes a second, where an app takes it: see [IoClient](../guides/io-client.md#dashboard).

## Status

| Status    | When                                    |
| --------- | --------------------------------------- |
| `started` | After the socket is bound and set up.   |
| `unhealthy` | The socket reported an error, with the error text as message. |
| `stopped` | After a stop. The socket is closed.     |

## Example

```ts
import { App, AppBase } from '@syncbridge/common';
import { UdpListenerComponent } from '@syncbridge/builtins';

@App({ displayName: 'Beacon Reader' })
export class BeaconReaderApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly beacons: UdpListenerComponent;

  protected async _init(): Promise<void> {
    await super._init();
    this.beacons.on('data', (data, info) => {
      console.log(`beacon from ${info.address}:${info.port}`, data.toString());
      this.beacons.write('ACK', info.port, info.address);
    });
  }
}
```

## Notes

- The component joins the multicast groups and sets broadcast once the
  socket is bound.
- An error on the socket, such as a failed bind, is logged, emitted as
  `error`, and makes the component `unhealthy`. A failure to join a
  multicast group or to enable broadcast is reported the same way.
