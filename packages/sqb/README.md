# @syncbridge/sqb

Database access for SyncBridge apps, built on
[SQB](https://github.com/panates/sqb). The module has one component, a
pooled SQL client for PostgreSQL, Oracle, SQL Server, MySQL, MariaDB and
SQLite. An app gets the client from
the component and runs its queries; the component tests the connection
and reports its health.

[![CI Tests][ci-test-image]][ci-test-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[ci-test-image]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml/badge.svg
[ci-test-url]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml
[coveralls-image]: https://img.shields.io/coveralls/syncbridge-io/syncbridge-extensions/dev.svg
[coveralls-url]: https://coveralls.io/r/syncbridge-io/syncbridge-extensions

## Components

| Component   | Description                                                      |
| ----------- | ---------------------------------------------------------------- |
| `SqbClient` | Connection pool to a PostgreSQL, Oracle, SQL Server, MySQL, MariaDB or SQLite database, with a `queries` log channel |

## Install

SyncBridge servers install modules from the SyncBridge registry, through
the Marketplace or Console. The module is published there, not on npm:
the 1.0.x versions on npm are old and no longer updated.

It needs `@syncbridge/common`, which the engine provides. The SQB packages
of every database, their drivers (`postgrejs`, `oracledb`, `mssql`,
`mysql2`, `mariadb`) and `ansi-colors` are installed with it. The component
loads only the driver of the database it is set to. Oracle's native client
is optional, see
[Database drivers](https://github.com/syncbridge-io/syncbridge-extensions/blob/main/packages/sqb/docs/SqbClient/drivers.md).

## Example

```ts
import { App, AppBase } from '@syncbridge/common';
import { SqbClientComponent } from '@syncbridge/sqb';

@App({ displayName: 'Orders' })
export class OrdersApp extends AppBase {
  @App.UseComponent({ required: true })
  declare readonly db: SqbClientComponent;

  async countOrders() {
    const result = await this.db.getClient().execute('select count(*) from orders');
    return result.rows;
  }
}
```

## Documentation

[docs](https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/sqb/docs)
