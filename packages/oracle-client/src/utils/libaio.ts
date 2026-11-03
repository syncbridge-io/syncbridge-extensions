import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/* Where a distribution puts it; the architecture's directory included */
const DIRECTORIES = [
  '/lib',
  '/lib64',
  '/usr/lib',
  '/usr/lib64',
  '/usr/lib/x86_64-linux-gnu',
  '/usr/lib/aarch64-linux-gnu',
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
  for (const dir of DIRECTORIES) {
    if (readable(path.join(dir, SONAME))) return true;
    if (!t64 && readable(path.join(dir, T64))) t64 = path.join(dir, T64);
  }
  if (t64) return t64;
  /* A distribution that keeps it elsewhere, or a plugin that may not look:
   * the linker's own cache, as "libaio.so.1 (libc6,x86-64) => /path" */
  let out: string;
  try {
    out = execFileSync('ldconfig', ['-p'], { encoding: 'utf8' });
  } catch {
    return false;
  }
  for (const line of out.split('\n')) {
    const match = /^\s*(libaio\.so\.1(?:t64)?)\s.*=>\s*(\S+)/.exec(line);
    if (match?.[1] === SONAME) return true;
    if (match && !t64) t64 = match[2];
  }
  return t64 || false;
}

/**
 * Whether the file is there. Under the engine's permission model a plugin
 * may not look outside its data directory, and `existsSync` throws there
 * rather than answer: a path it may not read tells nothing, and `ldconfig`
 * is asked instead.
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
  'It belongs to the server, not to this plugin: install libaio1t64 (Ubuntu 24.04 and later), libaio1 (older Debian, Ubuntu) or libaio (RHEL, Alma, Rocky), or run SyncBridge from its Docker image, which carries it.';

/** What to tell when the host has `libaio.so.1t64` alone, at `t64` */
export function libaioT64Only(t64: string): string {
  const link = path.join(path.dirname(t64), SONAME);
  return (
    `Instant Client needs libaio.so.1, and this server has only ${T64} (Ubuntu 24.04 and later). ` +
    `Link it once, as root: "sudo ln -s ${T64} ${link}", then restart SyncBridge. See "libaio" in the plugin's documentation.`
  );
}
