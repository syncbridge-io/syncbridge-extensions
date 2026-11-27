# @syncbridge/serialport

Serial port access for SyncBridge apps. The module has one component that
opens a serial port (RS-232, RS-485 or USB serial adapter), reads what the
device sends, writes to it, and opens the port again when the device goes
away and comes back.

[![SyncBridge Version][spm-image]][spm-url]
[![CI Tests][ci-test-image]][ci-test-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[spm-image]: https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.syncbridge.io%2Fregistry%2Fpkg%2F%40syncbridge%2Fserialport&query=%24.version&label=syncbridge&color=blue
[spm-url]: https://syncbridge.io/marketplace/pkg/syncbridge/serialport
[ci-test-image]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml/badge.svg
[ci-test-url]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml
[coveralls-image]: https://img.shields.io/coveralls/syncbridge-io/syncbridge-extensions/main.svg
[coveralls-url]: https://coveralls.io/r/syncbridge-io/syncbridge-extensions

## Components

| Component    | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| `SerialPort` | Serial port client with reconnect and a `communication` log channel |

## Install

SyncBridge servers install modules from the SyncBridge registry, through
the Marketplace or Console. The module is published there, not on npm:
the 1.0.x versions on npm are old and no longer updated.

It needs `@syncbridge/common`, which the engine provides, and
`@syncbridge/builtins`. `serialport` (13.x, with native bindings),
`@serialport/bindings-interface`, `reconnect-core`, `putil-varhelpers` and
`ansi-colors` are installed with it. `serialport` needs a prebuilt binary
for the platform or a build toolchain; see
[Device setup](https://github.com/syncbridge-io/syncbridge-extensions/blob/main/packages/serialport/docs/SerialPort/device-setup.md).

## Example

```ts
import { App, AppBase } from '@syncbridge/common';
import { SerialClientComponent } from '@syncbridge/serialport';

@App({ displayName: 'Serial echo' })
export class SerialEchoApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly line: SerialClientComponent;

  protected async _init(): Promise<void> {
    await super._init();
    this.line.on('data', (data: Buffer) => {
      this.line.write(data.toString('latin1').toUpperCase());
    });
  }
}
```

## Documentation

[docs](https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/serialport/docs)
