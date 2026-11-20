# @syncbridge/kafka

Apache Kafka components for SyncBridge, built on
[@platformatic/kafka](https://www.npmjs.com/package/@platformatic/kafka). A
producer sends messages to topics, and a consumer reads them as part of a
consumer group.

[![CI Tests][ci-test-image]][ci-test-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[ci-test-image]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml/badge.svg
[ci-test-url]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml
[coveralls-image]: https://img.shields.io/coveralls/syncbridge-io/syncbridge-extensions/dev.svg
[coveralls-url]: https://coveralls.io/r/syncbridge-io/syncbridge-extensions

## Components

| Component     | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| KafkaProducer | Sends messages to Kafka topics.                                 |
| KafkaConsumer | Reads messages from topics as a member of a consumer group.     |

## Install

SyncBridge servers install modules from the SyncBridge registry, through
the Marketplace or Console. The module is published there, not on npm:
the 1.0.x versions on npm are old and no longer updated.

It needs `@syncbridge/common`, which the engine provides, and
`@syncbridge/builtins`. `@platformatic/kafka` is installed with it.

## Example

```ts
import { App, AppBase } from '@syncbridge/common';
import { KafkaConsumerComponent, KafkaProducerComponent } from '@syncbridge/kafka';

@App({ description: 'Copies orders to another topic' })
export class OrderCopyApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly input: KafkaConsumerComponent;

  @App.UseComponent({ required: true })
  declare readonly output: KafkaProducerComponent;

  protected async _init(): Promise<void> {
    await super._init();
    this.input.on('message', async message => {
      await this.output.send({
        messages: [{ topic: 'orders-copy', value: message.value }],
      });
    });
  }
}
```

## Documentation

https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/kafka/docs
