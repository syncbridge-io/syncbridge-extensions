import fs from 'node:fs';
import path from 'node:path';

/* Where Debian and Ubuntu put it, the hosts SyncBridge is packaged for.
 * The engine lets a plugin read /lib, /usr/lib and /usr/local/lib and
 * what is below them; not /lib64 nor /usr/lib64 */
export const LIBAIO_DIRECTORIES = [
  '/usr/lib/x86_64-linux-gnu',
  '/usr/lib/aarch64-linux-gnu',
  '/lib/x86_64-linux-gnu',
  '/lib/aarch64-linux-gnu',
  '/usr/lib',
  '/lib',
  '/usr/local/lib',
];
/* What Instant Client's libclntsh asks for */
const SONAME = 'libaio.so.1';
/* The same library as Ubuntu 24.04 names it, which libclntsh does not find */
const T64 = 'libaio.so.1t64';

/**
 * What the host has of libaio, which Instant Client links against:
 * `true` for `libaio.so.1`, the path of `libaio.so.1t64` when that is all
 * there is, `false` for neither. It is the host's to provide - the Docker
 * image carries it, the Linux package depends on it - so the plugin only
 * tells the admin what to do; it changes nothing of the system.
 */
export function findLibaio(): boolean | string {
  /* Only Linux links against it; elsewhere the client is not ours to judge */
  if (process.platform !== 'linux') return true;
  let t64: string | undefined;
  for (const dir of LIBAIO_DIRECTORIES) {
    if (readable(path.join(dir, SONAME))) return true;
    if (!t64 && readable(path.join(dir, T64))) t64 = path.join(dir, T64);
  }
  return t64 || false;
}

/**
 * Whether the file is there. Under the engine's permission model
 * `existsSync` throws for a path the plugin may not read, rather than
 * answer: such a path tells nothing.
 */
function readable(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

export const LIBAIO_MISSING =
  'libaio is not installed on this server, and Instant Client cannot load without it. ' +
  'It belongs to the server, not to this plugin: install libaio1t64 (Ubuntu 24.04 and later) or libaio1 (older Debian, Ubuntu), or run SyncBridge from its Docker image, which carries it.';

/** What to tell when the host has `libaio.so.1t64` alone, at `t64` */
export function libaioT64Only(t64: string): string {
  const link = path.join(path.dirname(t64), SONAME);
  return (
    `Instant Client needs libaio.so.1, and this server has only ${T64} (Ubuntu 24.04 and later). ` +
    `Link it once, as root: "sudo ln -s ${T64} ${link}", then restart SyncBridge. See "libaio" in the plugin's documentation.`
  );
}
