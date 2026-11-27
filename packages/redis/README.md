# @syncbridge/redis

Redis client components for SyncBridge, built on
[ioredis](https://www.npmjs.com/package/ioredis). A component manages the
connection (login, TLS, reconnection, status) and gives the app the ioredis
client to run commands with.

[![SyncBridge Version][spm-image]][spm-url]
[![CI Tests][ci-test-image]][ci-test-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[spm-image]: https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.syncbridge.io%2Fregistry%2Fpkg%2F%40syncbridge%2Fredis&query=%24.version&label=syncbridge&color=blue
[spm-url]: https://syncbridge.io/marketplace/pkg/syncbridge/redis
[ci-test-image]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml/badge.svg
[ci-test-url]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml
[coveralls-image]: https://img.shields.io/coveralls/syncbridge-io/syncbridge-extensions/main.svg
[coveralls-url]: https://coveralls.io/r/syncbridge-io/syncbridge-extensions

## Components

| Component       | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| RedisStandalone | Connects to a single Redis server.                             |
| RedisSentinel   | Asks Redis Sentinel for the master and connects to it.         |

## Install

SyncBridge servers install modules from the SyncBridge registry, through
the Marketplace or Console. The module is published there, not on npm:
the 1.0.x versions on npm are old and no longer updated.

It needs `@syncbridge/common`, which the engine provides, and
`@syncbridge/builtins`. `@jsopen/objects` and `ioredis` are installed with
it.

## Example

```ts
import { App, AppBase } from '@syncbridge/common';
import { RedisStandaloneComponent } from '@syncbridge/redis';

@App({ description: 'Counts calls' })
export class CounterApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly redis: RedisStandaloneComponent;

  async count(): Promise<number> {
    return this.redis.client.incr('calls');
  }
}
```

## Documentation

https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/redis/docs
