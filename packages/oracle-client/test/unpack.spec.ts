import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { expect } from 'expect';
import { unpackClient } from '../src/utils/unpack.js';
import { addSymlink, clientZip } from './_support/zip-server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../..');

describe('unpackClient', () => {
  let base: string;
  let data: string;

  beforeEach(() => {
    /* Real paths: the permission model compares them as they are */
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'unpack-')));
    data = path.join(base, 'data');
    fs.mkdirSync(data);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const write = (zip: Buffer): string => {
    const file = path.join(data, 'client.zip');
    fs.writeFileSync(file, zip);
    return file;
  };

  it('should make a symlink of the zip a hard link to its target', () => {
    const target = path.join(data, 'instantclient');
    unpackClient(write(clientZip()), target);
    const link = fs.statSync(path.join(target, 'libclntsh.so'));
    const library = fs.statSync(path.join(target, 'libclntsh.so.23.1'));
    expect(link.ino).toBe(library.ino);
  });

  it('should take the directory holding libclntsh, leaving META-INF out', () => {
    const target = path.join(data, 'instantclient');
    unpackClient(write(clientZip()), target);
    expect(fs.readdirSync(target).sort()).toEqual([
      'libclntsh.so',
      'libclntsh.so.23.1',
      'network',
    ]);
  });

  it('should leave what it unpacks readable by all, whatever the umask', () => {
    const umask = process.umask(0o077);
    try {
      const target = path.join(data, 'instantclient');
      unpackClient(write(clientZip()), target);
      const mode = (file: string) =>
        fs.statSync(path.join(target, file)).mode & 0o777;
      expect(mode('.')).toBe(0o755);
      expect(mode('network')).toBe(0o755);
      expect(mode('network/admin')).toBe(0o755);
      expect(mode('libclntsh.so.23.1')).toBe(0o755);
      expect(mode('network/admin/README')).toBe(0o644);
    } finally {
      process.umask(umask);
    }
  });

  it('should link a symlink that comes before its target', () => {
    const zip = new AdmZip();
    addSymlink(zip, 'ic/libclntsh.so', 'libclntsh.so.19.1');
    zip.addFile('ic/libclntsh.so.19.1', Buffer.from('library'));
    const target = path.join(data, 'instantclient');
    unpackClient(write(zip.toBuffer()), target);
    expect(fs.readFileSync(path.join(target, 'libclntsh.so'), 'utf8')).toBe(
      'library',
    );
  });

  it('should refuse a symlink to a file outside the zip', () => {
    const zip = new AdmZip();
    zip.addFile('ic/libclntsh.so.19.1', Buffer.from('library'));
    addSymlink(zip, 'ic/libclntsh.so', '../../../../etc/passwd');
    expect(() =>
      unpackClient(write(zip.toBuffer()), path.join(data, 'ic')),
    ).toThrow('outside its directory');
  });

  it('should refuse an entry that leaves the directory', () => {
    const zip = new AdmZip(write(clientZip()));
    zip.getEntries()[0].entryName = '../escaped.so';
    expect(() =>
      unpackClient(write(zip.toBuffer()), path.join(data, 'ic')),
    ).toThrow('outside its directory');
    expect(fs.existsSync(path.join(data, 'escaped.so'))).toBe(false);
  });

  it('should unpack and ask for libaio under the permission model, its data directory alone given', () => {
    /* As the engine runs a plugin: it reads and writes its data directory,
     * the repository's code being read for the test to load it at all */
    const zip = write(clientZip());
    const target = path.join(data, 'instantclient');
    const tmp = path.join(base, 'tmp');
    fs.mkdirSync(tmp);
    const out = execFileSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${repository}`,
        `--allow-fs-read=${data}`,
        `--allow-fs-write=${data}`,
        /* swc compiles the test's TypeScript into a cache of its own */
        `--allow-fs-read=${tmp}`,
        `--allow-fs-write=${tmp}`,
        '--allow-worker',
        '--allow-addons',
        '--allow-child-process',
        '--no-warnings',
        '--import',
        '@swc-node/register/esm-register',
        path.join(here, '_support', 'under-permission.ts'),
        zip,
        target,
      ],
      {
        cwd: repository,
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: tmp },
      },
    );
    const result = JSON.parse(out.trim().split('\n').at(-1)!);
    expect(result.unpacked).toBe(true);
    expect(['boolean', 'string']).toContain(typeof result.libaio);
    expect(fs.existsSync(path.join(target, 'libclntsh.so'))).toBe(true);
  });
});
