# @syncbridge/oracle-client

Oracle Instant Client for a SyncBridge server. This package is a **plugin**,
not a module of components: it does not run in a worker, it prepares the
server. Once an admin has accepted Oracle's license it downloads Instant
Client, installs it beside its own data and adds it to the environment of
every worker, so an app that talks to Oracle through
[`@syncbridge/sqb`](../sqb) finds the client in Thick mode - what Oracle 11
answers in.

Oracle's license does not let SyncBridge carry Instant Client in its Docker
image or in its Linux package, which is why it is installed here, by someone
who accepts that license.

## What it brings

| Plugin               | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `OracleClientPlugin` | Installs Instant Client after the license is accepted and gives it to the workers |

## Install

On a SyncBridge server, install the package from Console, then turn the
plugin on under Settings → Plugins, restart the server and approve the
plugin's permissions on its card. The package is published to the SyncBridge
registry, not to npm. The Marketplace does not list plugins.

It needs a SyncBridge built on `@syncbridge/plugin-api` 2.2 or newer; that
and `@syncbridge/common` are peer dependencies, provided by the engine.
`libaio` belongs to the server - the Docker image carries it, the Linux
package depends on it - and the plugin says so when it is missing. On
Ubuntu 24.04 and later it needs a `libaio.so.1` link, made once by the
admin: see
[libaio](https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/oracle-client/docs/OracleClientPlugin/README.md#ubuntu-2404-and-later).

## Actions

Its card on the Plugins page carries three buttons: **Install now** (which
also asks Oracle's license again), **Install from file** for a server that
does not reach Oracle, and **Remove**.

## Documentation

[docs](https://github.com/syncbridge-io/syncbridge-extensions/tree/main/packages/oracle-client/docs)
