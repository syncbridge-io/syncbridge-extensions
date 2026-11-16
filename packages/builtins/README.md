# @syncbridge/builtins

The base module of SyncBridge. It holds the abstract IO components that
other modules build on (the HL7, serial port and tunnel modules extend them),
the network components that need nothing outside Node.js - TCP and UDP clients
and servers, and an HTTP server - and an app that bridges two IO peers. The
network components write their traffic to the `communication` log channel
and work with the `IOBridge` app.

[![CI Tests][ci-test-image]][ci-test-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[ci-test-image]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml/badge.svg
[ci-test-url]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml
[coveralls-image]: https://img.shields.io/coveralls/syncbridge-io/syncbridge-extensions/dev.svg
[coveralls-url]: https://coveralls.io/r/syncbridge-io/syncbridge-extensions

## What it brings

| Name          | Kind                | Description                                                                                          |
| ------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `IoClient`    | abstract component  | Base of components that connect to a peer. Writes its traffic to the `communication` log channel.    |
| `IoServer`    | abstract component  | Base of components that accept connections. Writes its traffic to the `communication` log channel.   |
| `IOBridge`    | app                 | Passes what one IO peer reads to the other peer, in both directions.                                 |
| `TcpClient`   | component           | Connects to a TCP server, with reconnection, TLS and a SOCKS proxy.                                  |
| `TcpServer`   | component           | Listens for TCP connections, with TLS, socket options and an IP block list.                          |
| `UdpClient`   | component           | Sends and receives UDP datagrams, to one host or to any.                                             |
| `UdpListener` | component           | Listens on a UDP port, with broadcast and multicast groups.                                          |
| `HttpServer`  | component           | Listens for HTTP or HTTPS requests. The app handles them on the Node.js server.                      |
| `peerOf()`    | function            | Formats the other side of a connection (`address:port`) for a log record's `details`.                |

The abstract components cannot be used in an app on their own. Extend them
to write a component, or use a module that does.

## Install

SyncBridge servers install modules from the SyncBridge registry, through
the Marketplace or Console. The module is published there, not on npm:
the 1.0.x versions on npm are old and no longer updated.

It needs `@syncbridge/common`, which the engine provides. Its other
dependencies (`backoff`, `socks`, `ansi-colors`, `@jsopen/objects`,
`node-events-async`) come with it.

## Example

An app that answers what a TCP client sends it, and listens to a device:

```ts
import { App, AppBase } from '@syncbridge/common';
import { TcpClientComponent, TcpServerComponent } from '@syncbridge/builtins';

@App({ displayName: 'Echo' })
export class EchoApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly listener: TcpServerComponent;

  @App.UseComponent()
  declare readonly device?: TcpClientComponent;

  protected async _init(): Promise<void> {
    await super._init();
    this.listener.server.on('connection', socket =>
      socket.on('data', data => socket.write(data)),
    );
    this.device?.on('connect', () => this.device!.write('hello'));
    this.device?.on('data', data => console.log(String(data)));
  }
}
```

A component that extends `IoClientBaseComponent` and an app that uses it:

```ts
import { IoClientBaseComponent } from '@syncbridge/builtins';
import { Component } from '@syncbridge/common';

@Component({ className: 'MyClient' })
export class MyClientComponent extends IoClientBaseComponent {
  readonly protocol = 'my';

  write(data: string | Buffer): void {
    // send data to the device, then tell the engine and the log
    this.emit('transmit', Buffer.from(data));
  }
}
```

## Documentation

https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/builtins/docs
