# @syncbridge/pinggy

A tunnel through [Pinggy](https://pinggy.io) for SyncBridge apps. The module
has one component that opens a local TCP server and a Pinggy tunnel to it,
so a device or a service on the internet can connect to the server behind a
firewall or a NAT. The app reads what the remote side sends and writes back.

[![CI Tests][ci-test-image]][ci-test-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[ci-test-image]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml/badge.svg
[ci-test-url]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml
[coveralls-image]: https://img.shields.io/coveralls/syncbridge-io/syncbridge-extensions/dev.svg
[coveralls-url]: https://coveralls.io/r/syncbridge-io/syncbridge-extensions

## Components

| Component          | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `PinggyTcpClient`  | TCP tunnel through Pinggy to a local server, with a `communication` log channel |

## Install

SyncBridge servers install modules from the SyncBridge registry, through
the Marketplace or Console. The module is published there, not on npm:
the 1.0.x versions on npm are old and no longer updated.

It needs `@syncbridge/common`, which the engine provides, and
`@syncbridge/builtins`. `@pinggy/pinggy` (the Pinggy SDK, 0.5.x),
`@jsopen/objects` and `ansi-colors` are installed with it. You also need a
Pinggy auth token, see the [component page](https://github.com/syncbridge-io/syncbridge-extensions/blob/main/packages/pinggy/docs/PinggyTcpClient/README.md).

## Example

```ts
import { App, AppBase } from '@syncbridge/common';
import { PinggyTcpClientComponent } from '@syncbridge/pinggy';

@App({ displayName: 'Tunnel echo' })
export class TunnelEchoApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly tunnel: PinggyTcpClientComponent;

  protected async _init(): Promise<void> {
    await super._init();
    this.tunnel.on('data', (data: Buffer) => this.tunnel.write(data));
  }
}
```

## Documentation

[docs](https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/pinggy/docs)
