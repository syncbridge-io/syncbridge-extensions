# OracleClientPlugin

`OracleClientPlugin` installs Oracle Instant Client on a SyncBridge server
and gives it to the workers. An app reaches Oracle through
`@syncbridge/sqb`; the driver answers an Oracle 11 database in Thick mode
only, and Thick mode needs Instant Client. Oracle's license does not let
SyncBridge carry the client in its image or its package, so an admin accepts
the license here and the plugin downloads it from Oracle.

## How it works

1. The plugin is turned on under Settings → Plugins
   (`plugins.oracle-client.enabled`) and the server is restarted.
   An admin approves its permissions on its card (see
   [Permissions](#permissions)); until then it is given none.
2. It asks Oracle's license on its card. The answer is kept with who gave it
   and when, so the question is asked once, not at every start. Declined, the
   plugin installs nothing, gives the workers nothing, and says so.
3. Accepted, with no client installed, it downloads the Basic package in the
   background - the server starts meanwhile - and tells its progress on the
   card.
4. It checks that what arrived is an Instant Client package (and its SHA-256,
   when the setting gives one), then unpacks it into `shared/instantclient`
   under the plugin's data directory - `shared/` is what the workers may
   read. Of Oracle's zip, the directory holding the libraries is what is
   installed, so they sit directly in `instantclient`.
5. It adds that directory to `LD_LIBRARY_PATH` and
   `instantclient/network/admin` to `TNS_ADMIN` for every worker that starts.
   A worker already running is marked "Restart required" - it takes the
   client when it restarts.
6. Its status then reads `Instant Client <version>`.

A client already installed is given to the workers at the next start without
asking Oracle for anything - as long as it is the version the settings name.

## Updating the client

The Version setting picks the Instant Client to install from the versions
Oracle serves for both x64 and arm64:

| Version       | Reaches Oracle Database |
| ------------- | ----------------------- |
| `23.26.4.0.0` | 19 and later            |
| `23.9.0.25.07`| 19 and later            |
| `19.32.0.0.0` | 11.2 and later          |

The default is 19, the last client that reaches an Oracle 11 database. A new
release of the plugin brings Oracle's newer versions to the list.

To update, change the version and restart the server, or run
**Install now**. At the start the plugin finds the installed client is of
another version, gives it to the workers meanwhile, downloads the new one and
replaces it; a running worker takes it when it restarts. A download that fails
leaves the old client whole, the workers keep it, and the card tells why.

## Permissions

The plugin declares what it reaches beyond its own data directory, and the
engine gives it that once an admin approves it on the plugin's card:

- **Worker environment**: to add the client to every worker's environment.
  Without it the client is installed but no worker sees it.
- **Network**, to `download.oracle.com` only: Oracle's download.
- **Child processes**: `ldconfig`, asked whether the host has libaio when it
  is not in the usual directories.

It needs a SyncBridge built on `@syncbridge/plugin-api` 2.2 or newer, which
is the first to grant permissions.

## Oracle's license

The question links to [Oracle's Instant Client
license](https://www.oracle.com/downloads/licenses/instant-client-lic.html).
Read it before accepting: accepting it is what lets this server download the
client, and the engine keeps the record of who accepted it.

To answer it again - a new license version, or a decline you want to take
back - run **Install now**, which asks it anew.

## Where it downloads from

From Oracle alone: the plugin builds Oracle's own address on
`download.oracle.com` from the Version setting and the server's architecture
(`x64` or `arm64`), and is granted the network to that host only. No address
is asked of the admin. Should Oracle move its downloads, a new version of the
plugin follows it; a server that cannot download meanwhile installs from a
file.

## Actions

| Action              | What it does                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `install`           | Downloads the client again from Oracle, and asks Oracle's license again first                          |
| `from-file`         | Installs a zip that is already on the server, by its path - see [installing without reaching Oracle](installing-without-oracle.md) |
| `remove`            | Deletes the client and takes it back from the workers' environment. They keep it until they restart    |

Only an admin with the settings permission runs them, and the engine's log
tells who ran what.

## libaio

Instant Client links against `libaio.so.1`, which belongs to the server
rather than to this plugin: SyncBridge's Docker image carries it, and its
Linux package depends on it. On a host without it the plugin installs the
client and then says that `libaio` is missing instead of giving the workers a
client they cannot load - install `libaio1` (Debian, Ubuntu up to 22.04) or
`libaio` (RHEL, Alma, Rocky) and restart the server.

### Ubuntu 24.04 and later

Ubuntu 24.04 replaced `libaio1` with `libaio1t64`, which installs the library
as `libaio.so.1t64` alone. Instant Client does not find it under that name,
so the plugin says so on its card and gives the workers nothing. Link it once
under the name Instant Client asks for, as root:

```bash
# amd64
sudo ln -s libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1
# arm64
sudo ln -s libaio.so.1t64 /usr/lib/aarch64-linux-gnu/libaio.so.1
```

Then restart SyncBridge: the plugin finds the link and gives the client to
the workers. The plugin does not make the
link itself: it changes nothing outside its own data directory, and the
engine gives a plugin no right to.

## What it does not do

The plugin never reads or writes a worker's data, and nothing of it runs in
the browser: its card, its question and its buttons are drawn by SyncBridge.
Uploading the zip through the browser is not available yet; `from-file` takes
a path on the server.
