# Changelog


<!-- rman:documented-up-to 807763c11854f1d09fab101003e720fc16f7fe3c -->

## @syncbridge/builtins@2.3.0 (2026-11-12)

### ✨ Features

- **builtins:** glance and activity lines for the IO components and IOBridge, and a per-minute counter for other modules (4c66ace)

---

## @syncbridge/builtins@2.2.0 (2026-10-31)

### ✨ Features

- **builtins:** dashboards of the IO clients and servers (a70567b)
- **builtins:** traffic charts on the IO dashboards (6d309a8)
- **builtins:** a Bridge dashboard for the IO Bridge app (6f5e0db)
- **builtins:** dashboard texts in six languages (2e91f7d)

### 🔧 Refactoring

- **builtins:** IO widgets shown where an app includes them (27faa82)

---

## @syncbridge/builtins@2.1.0 (2026-10-30)

### ✨ Features

- **builtins:** names, summaries and settings in Turkish, German, French, Spanish, Italian and Brazilian Portuguese (84c3be6)

### 🐛 Bug Fixes

- **builtins:** UdpListener port described as the port it listens on (bab729b)

### 🔧 Refactoring

- **builtins:** the bridge app is registered as IOBridge (88eac6b)

### 🧹 Chores

- upgrade dependencies (1e30741)

---

## @syncbridge/builtins@2.0.1 (2026-10-26)

### 📚 Documentation

- the abstract bases' documents among the package's own - IoClient and IoServer (builtins), Redis (redis) in docs/guides/, as syncbuild 2.4 offers an abstract class nowhere (ff6b427)

---

## @syncbridge/builtins@1.0.2 (2026-10-11)

### 🐛 Bug Fixes

- **extensions:** declare dependencies as ranged peers (a3d8b34)
