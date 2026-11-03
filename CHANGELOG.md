# Changelog

<!-- rman:documented-up-to e407dbd51dfe30082288c1e7173b2d0a4d9830c6 -->

## v2026.11.3-1541 (2026-11-03)

### 🧹 Chores

- @syncbridge/common 2.21.0, syncbuild 2.16.0, testing 2.6.0 and globals 17.14.0 for development (e407dbd)

---

## v2026.10.31-2058 (2026-10-31)

### ✨ Features

- **builtins:** dashboards of the IO clients and servers (a70567b)
- **builtins:** traffic charts on the IO dashboards (6d309a8)
- **hl7:** a Messages dashboard for the client and the server (f70b738)
- **sqb:** a dashboard of the database client (ba3998b)

### 🔧 Refactoring

- **builtins:** IO widgets shown where an app includes them (27faa82)

### 🧪 Tests

- each module's test tsconfig extends the root's (67a9c09)

### 🧹 Chores

- upgrade dependencies (44ef9c8)
- @syncbridge/common 2.18 and syncbuild 2.15 (5541b38)

---

## v2026.10.30-2303 (2026-10-30)

### 📚 Documentation

- pnpm build is part of the definition of done, and syncbridge-engine makes the SDK's changes (5ded09e)

### 🧹 Chores

- syncbuild 2.13.0 and @syncbridge/common 2.14.0 for development, spm checking peers against what the engine provides (9833f7c)
- rman 2.41.0, whose release commits name their package (5ca3128)
- rman 2.41.2, syncbuild 2.14.0 and eslint 10.14.0 for development (2a3b1cd)
- rman 2.41.3 for development (6065c17)

---

## v2026.10.30-943 (2026-10-30)

### ✨ Features

- **oracle-client:** the Oracle Instant Client plugin (ac745cc)
- **sqb:** SQL Server, MySQL, MariaDB and SQLite dialects (7688960)
- **hl7:** HL7Client connects through its SOCKS proxy settings (69d346a)

### 🐛 Bug Fixes

- take rman 2.39 as a root devDependency (3ad5487)
- **oracle-client:** declare its permissions and require plugin-api 2.2 (c941e5d)

### 🔧 Refactoring

- modules take @syncbridge/builtins as a registry dependency (c6658a1)

### 📚 Documentation

- install the modules from the SyncBridge registry, not npm (e98633b)
- the trusted publisher follows a renamed repository by its id (bae8c87)
- this directory is extensions, beside syncbridge and node-sdk (756dc5e)
- drop the settings tables, the UI shows them (a644367)
- the old npm versions are removed, and private beside publishConfig keeps nothing out of a release (ab6a48c)

### 🧹 Chores

- sync lockfile [skip ci] (2cf5322)
- **oracle-client:** take the released plugin-api 2.1 and syncbuild 2.6 (45b0724)
- run spm and tsc with pnpm exec, not npx (71c97dd)
- no minimum release age in this repository (a929d9b)
- the repository is syncbridge-io/syncbridge-extensions (fe706f6)
- dpdm is not a devDependency, rman installs it (de5dc18)
- take @syncbridge/common 2.9 and syncbuild 2.10, which build translations (4b9bbf4)
- syncbuild 2.11 and @syncbridge/common 2.11 (6e62bc5)
- upgrade dependencies (1e30741)
- lockfile from a clean install (021b479)
- coverage of all modules in the test workflow (cdc125d)
- root package named after the repository (db668e3)
- rman 2.40.3, @syncbridge/common 2.13.1 and syncbuild 2.12.1 for development (a57eb70)
- the modules peer @syncbridge/common ^2.13.1, oracle-client @syncbridge/plugin-api ^2.3.0 (9428ecb)
- the modules built on builtins take it as a workspace devDependency, for their build's types (645cc70)

### 💬 General Changes

- Merge branch 'oracle-client' into dev (1536ff6)

---

## v2026.10.26-1439 (2026-10-26)

### 📚 Documentation

- check dependencies with rman deps before every push (7b1b649)
- the modules are published to the SyncBridge registry, not to npm (b30b93c)

### 🧹 Chores

- sync lockfile to the versions of the release (815d6da)
- take @syncbridge/runtime 2.0.2: spm verify no longer fetches a module's own peers from npm (1798991)
- take @syncbridge/common 2.1.0 and syncbuild 2.4.2 (e3f0202)
- take @syncbridge/syncbuild 2.4.3 (49623fe)
- take @syncbridge/common 2.3.1 and syncbuild 2.5.1 (da4ccbb)
- install with pnpm (2bf0a0c)
- declare the tools @panates/rman-preset takes as peers - dpdm, eslint, prettier (59c28ca)
- the packages come from pnpm-workspace.yaml alone (2f2c181)

---

## v2026.10.21-1522 (2026-10-21)

### ✨ Features

- the SyncBridge modules, open sourced under Apache-2.0 - builtins, net, hl7, kafka, redis, sqb, serialport, ngrok, pinggy; built, tested and released from here (4d9623d)
- **builtins,net,hl7,kafka,redis,sqb,serialport,ngrok,pinggy:** require @syncbridge/common 2 (9eebeb9)
- **builtins:** take in the net components: TCP and UDP clients and servers, an HTTP server; @syncbridge/net is gone (d67a96c)

### 🐛 Bug Fixes

- **net:** tell the error that dropped a TCP connection, apply the HTTP protocol options, remove the right listener on start, close open connections on stop (9908783)
- **net,hl7,serialport,sqb,ngrok,pinggy:** list network addresses and serial ports as enum sources of the engine, not at import time; restart in place when values change (176df38)
- **net:** tell UDP bind errors, keep local datagrams and bind the client's own port, block subnets together with addresses, wait for the TLS handshake, tell the error of a lost TCP connection, apply the HTTP socket timeout and header count, label settings rightly (e9e8ede)
- **builtins,net,hl7,kafka,redis,sqb,serialport,ngrok,pinggy:** declare tslib: the compiled code imports it, and SyncBridge installs only what a package declares (f3e0b29)

### 🔧 Refactoring

- **net,hl7,sqb:** build the client or server when the component starts, and restart in place when values change (6490c87)

### 📚 Documentation

- CLAUDE.md - what this repository does, how to work in it, how its modules are written, documented and released (5b3633b)
- the platform's engine runs these modules' sources in development (3ef58f4)
- **net:** the module's README, and a page for each of its components and apps (ad39139)
- **net:** follow the fixes of the module's code (a1bc523)
- **builtins,net,hl7,kafka,redis,sqb,serialport,ngrok,pinggy:** a summary for each component and app, for its card in the Marketplace (b0b8e3f)
- the platform repository is at ~/dev/syncbridge/cloud, beside this one and node-sdk (d517efd)
- the net module is in builtins: README, CLAUDE.md, release and verify matrices (adbb49b)

### 🧪 Tests

- **net,serialport:** the virtual network and serial port of @syncbridge/testing, tested with them here - moved from the platform (7fc3d56)
- **builtins:** peerOf, the communication channel of the IO bases, the IO bridge app (3154cb0)
- **ngrok:** the tunnel's life, retries, stop while opening, data and values changes, with the ngrok agent replaced (11d74e9)
- **pinggy:** the tunnel's life, status polling, errors, stop while opening, data and values changes, with the Pinggy SDK replaced (af45877)

### 🤖 Continuous Integration

- verify every module with spm before a release, and publish the released versions to the SyncBridge registry after the npm publish (b3382c0)
- the registry job runs only when SB_REGISTRY_PUBLISH is true, as the registry's cloud is not deployed; CLAUDE.md follows the platform's release (335ff79)
- remove quality check workflow and update .prettierignore (1845bb2)
- spm verify as rman hooks, before each module's tests and right before spm publishes it, instead of a workflow with a matrix to keep by hand (83ac42d)

### 🧹 Chores

- **builtins,net,hl7,kafka,redis,sqb,serialport,ngrok,pinggy:** a syncbridge-manifest.json for each module, which is what marks it as an extension package for spm verify (89fabaf)
- the repository moved to github.com/syncbridge-io/public-modules (ce111d5)
- take @syncbridge/common 2.0.1 and syncbuild 2.1.0 from npm (4978657)
- publish the modules to the SyncBridge registry with the spm target of rman, not to npm (73c7877)
- drop the changelog markers left from the platform repository: they name a commit this repository does not have, and rman version stopped at it (5d0502f)
- update dependencies: @syncbridge/common 2.0.1 as the modules' peer, the eslint configs and the rman preset (6a26bce)

### 💬 General Changes

- Initial commit (5ab056c)
- the platform's packages taken from its local builds, until it releases them; its problems reported to its session, never worked around (5073a85)
- the SDK is its own repository (syncbridge-io/node-sdk): use-platform-builds.mjs takes its builds from ../node-sdk, CLAUDE.md names the two repositories (d40c36e)
