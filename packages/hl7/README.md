# @syncbridge/hl7

HL7 v2 over MLLP for SyncBridge. The module has two components: a server that
receives HL7 messages and acknowledges them, and a client that connects to an
HL7 server and exchanges messages with it. Parsing and framing are done by
[hl7v2](https://www.npmjs.com/package/hl7v2) and
[hl7v2-net](https://www.npmjs.com/package/hl7v2-net).

[![SyncBridge Version][spm-image]][spm-url]
[![CI Tests][ci-test-image]][ci-test-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[spm-image]: https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.syncbridge.io%2Fregistry%2Fpkg%2F%40syncbridge%2Fhl7&query=%24.version&label=syncbridge&color=blue
[spm-url]: https://syncbridge.io/marketplace/pkg/syncbridge/hl7
[ci-test-image]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml/badge.svg
[ci-test-url]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml
[coveralls-image]: https://img.shields.io/coveralls/syncbridge-io/syncbridge-extensions/main.svg
[coveralls-url]: https://coveralls.io/r/syncbridge-io/syncbridge-extensions

## Components

| Component   | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| HL7Server   | Listens on a TCP port (optionally TLS) and acknowledges messages.  |
| HL7Client   | Connects to an HL7 server, reconnects when the connection is lost. |
| HL7Endpoint | Abstract base of the two: an app slot of this type takes either.   |

## Install

SyncBridge servers install modules from the SyncBridge registry, through
the Marketplace or Console. The module is published there, not on npm:
the 1.0.x versions on npm are old and no longer updated.

It needs `@syncbridge/common`, which the engine provides, and
`@syncbridge/builtins`. `ansi-colors`, `hl7v2` and `hl7v2-net` are installed
with it.

## Example

An app that stores every received ORU message and acknowledges it:

```ts
import { App, AppBase } from '@syncbridge/common';
import { HL7ServerComponent } from '@syncbridge/hl7';

@App({ description: 'Receives ORU messages' })
export class OruReceiverApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly hl7: HL7ServerComponent;

  protected async _init(): Promise<void> {
    await super._init();
    this.hl7.use(async (req, res) => {
      // Store req.message here; a thrown error becomes a negative answer.
      res.message = req.message.createAck();
    });
  }
}
```

## Documentation

https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/hl7/docs
