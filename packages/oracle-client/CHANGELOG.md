# Changelog

<!-- rman:documented-up-to e407dbd51dfe30082288c1e7173b2d0a4d9830c6 -->

## @syncbridge/oracle-client@1.1.3 (2026-11-03)

### 🐛 Bug Fixes

- **oracle-client:** a host with Ubuntu 24.04's libaio.so.1t64 alone is told the link to make (73fbbb0)

---

## @syncbridge/oracle-client@1.1.1 (2026-10-30)

### 🐛 Bug Fixes

- **oracle-client:** install under the engine's permission model (874d649)
- **oracle-client:** give the workers a client they may read (8246c15)

---

## @syncbridge/oracle-client@1.1.0 (2026-10-30)

### ✨ Features

- **oracle-client:** the Oracle Instant Client plugin (ac745cc)
- **oracle-client:** name, description and settings in Turkish, German, French, Spanish, Italian and Brazilian Portuguese (93e7bde)
- **oracle-client:** a changed version is installed at the next start, the old client kept until it is (15e003b)
- **oracle-client:** the version is picked from the ones Oracle serves for x64 and arm64, 19 by default (13b2c20)

### 🐛 Bug Fixes

- **oracle-client:** Oracle's own download address, as it serves it (0fbd3eb)
- **oracle-client:** declare its permissions and require plugin-api 2.2 (c941e5d)
- **oracle-client:** Oracle's download directory takes three parts of the version, as 23.26.4 shows (d1e2923)

### 🔧 Refactoring

- **oracle-client:** download from Oracle's own address alone, no address asked of the admin (92f9410)

### 📚 Documentation

- **oracle-client:** permissions, download address on Oracle's host only, install from the registry (521ce8a)

### 🧹 Chores

- **oracle-client:** take the released plugin-api 2.1 and syncbuild 2.6 (45b0724)
- **oracle-client:** repository links follow the rename to syncbridge-extensions (72ef56c)
