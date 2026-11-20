# SyncBridge public modules

The open source modules of [SyncBridge](https://syncbridge.io): components and
apps a SyncBridge server runs - and examples to build modules of your own.

[![CI Tests][ci-test-image]][ci-test-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[ci-test-image]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml/badge.svg
[ci-test-url]: https://github.com/syncbridge-io/syncbridge-extensions/actions/workflows/test.yml
[coveralls-image]: https://img.shields.io/coveralls/syncbridge-io/syncbridge-extensions/dev.svg
[coveralls-url]: https://coveralls.io/r/syncbridge-io/syncbridge-extensions

| Module                                          | What it brings                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`@syncbridge/builtins`](packages/builtins)     | The IO bridge app, the base classes of client and server components, TCP clients and servers (TLS, SOCKS proxies), UDP clients and listeners, an HTTP server |
| [`@syncbridge/hl7`](packages/hl7)               | HL7 v2 clients and servers over MLLP                                                    |
| [`@syncbridge/kafka`](packages/kafka)           | Kafka producers and consumers                                                           |
| [`@syncbridge/redis`](packages/redis)           | Redis: standalone, sentinel and cluster                                                 |
| [`@syncbridge/sqb`](packages/sqb)               | SQL databases through SQB: PostgreSQL and Oracle                                        |
| [`@syncbridge/serialport`](packages/serialport) | Serial port connections                                                                 |
| [`@syncbridge/ngrok`](packages/ngrok)           | TCP tunnels through ngrok                                                               |
| [`@syncbridge/pinggy`](packages/pinggy)         | TCP tunnels through Pinggy                                                              |

Each is published to the SyncBridge registry - installable from the
Marketplace - and comes with the SyncBridge server.

## Plugins

A plugin is a package of another kind: it does not run in a worker, it
extends the server itself. The repository has one, and the Marketplace does
not list plugins - they are installed from Console and turned on under
Settings → Plugins.

| Plugin                                                | What it brings                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@syncbridge/oracle-client`](packages/oracle-client) | Installs Oracle Instant Client, once an admin has accepted Oracle's license, and gives it to the workers |

## Building your own module

A module is an npm package of components and apps, written in TypeScript
against [`@syncbridge/common`](https://www.npmjs.com/package/@syncbridge/common).
The modules here show how:

- **A component** - a client, a server, a connection: see
  [`packages/builtins/src/components`](packages/builtins/src/components). Its values
  (settings) are a class of their own beside it (`*.variables.ts`).
- **A component built on another module's**: [`@syncbridge/hl7`](packages/hl7)
  builds on `@syncbridge/builtins`, declared in its manifest's `dependencies`
  (`spm add`), so a server installs the version it needs from the registry.
- **An app** - what a worker runs, made of components: see
  [`packages/builtins/src/apps`](packages/builtins/src/apps).
- **Tests** that start a component and talk to it: see
  [`packages/builtins/test`](packages/builtins/test) and [`packages/hl7/test`](packages/hl7/test).

The developer guide is at [syncbridge.io/developers](https://syncbridge.io/developers/).

## Development

Node.js 22.12 or newer, and pnpm - the version `package.json`'s
`packageManager` field names, which pnpm and Corepack both install on their
own.

```bash
pnpm install
pnpm test
pnpm build
```

`pnpm test` checks the types and runs every module's tests; `pnpm lint`
lints them. Versions and releases are made with rman from
[Conventional Commits](https://www.conventionalcommits.org): a merge to `main`
releases the modules changed since.

## Contributing

Issues and pull requests are welcome. Commit messages follow Conventional
Commits (`feat:`, `fix:`, `docs:` ...), as they decide the next versions.

## License

[Apache License 2.0](LICENSE) - Copyright 2025-2026 Panates Teknoloji Yatırım
A.Ş.
