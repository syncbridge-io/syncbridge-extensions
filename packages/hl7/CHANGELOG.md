# Changelog


<!-- rman:documented-up-to 807763c11854f1d09fab101003e720fc16f7fe3c -->

## @syncbridge/hl7@2.3.0 (2026-11-12)

### ✨ Features

- **hl7:** glance and activity lines: where it connects or listens, its messages of the last minute, the last one and its errors (ccb3c31)

---

## @syncbridge/hl7@2.2.0 (2026-10-31)

### ✨ Features

- **hl7:** a Messages dashboard for the client and the server (f70b738)
- **hl7:** dashboard texts in six languages (6826137)

### 🔧 Refactoring

- **hl7:** Messages widgets shown where an app includes them (8d3bd4f)

---

## @syncbridge/hl7@2.1.0 (2026-10-30)

### ✨ Features

- **hl7:** HL7Endpoint, the abstract base of HL7Client and HL7Server (10614a2)
- **hl7:** names, summaries and settings in Turkish, German, French, Spanish, Italian and Brazilian Portuguese (1c53a7f)
- **hl7:** HL7Client connects through its SOCKS proxy settings (69d346a)

### 🧪 Tests

- **hl7:** wait for the server to see the connection before restarting the client (8fd8bfe)

---

## @syncbridge/hl7@1.2.0 (2026-10-12)

### ✨ Features

- **hl7:** HL7 options as variables, handlers kept on reconfiguration, beforeResponse (f5298b7)

---

## @syncbridge/hl7@1.1.1 (2026-10-11)

### 🐛 Bug Fixes

- **hl7:** adjust dependency ranges for peerDependencies (2756399)
- **extensions:** declare dependencies as ranged peers (a3d8b34)

---

## @syncbridge/hl7@1.1.0 (2026-10-11)

### 🐛 Bug Fixes

- **hl7:** move to hl7v2 and hl7v2-net 2.0 (209a2e7)

---

## @syncbridge/hl7@0.14.14 (2026-10-09)

### 🐛 Bug Fixes

- **hl7:** an HL7 client is started once it connects (d5634c7)

### 🧹 Chores

- **hl7:** release @syncbridge/hl7 again (5f47c44)
- release the extensions in packages/syncbridge again (0293b18)
