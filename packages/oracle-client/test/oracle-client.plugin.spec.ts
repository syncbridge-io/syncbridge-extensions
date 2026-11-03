import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import { OracleClientPlugin } from '../src/index.js';
import { type FakeHost, fakeHost, waitFor } from './_support/fake-host.js';
import { clientZip, type ZipServer, zipServer } from './_support/zip-server.js';

/** The plugin with the host's libaio played, a runner having none, and
 * Oracle's download played by a local server */
class TestPlugin extends OracleClientPlugin {
  libaio: boolean | string = true;
  downloadUrl = '';

  protected override _findLibaio(): boolean | string {
    return this.libaio;
  }

  protected override _downloadUrl(): string {
    return this.downloadUrl;
  }
}

describe('OracleClientPlugin', () => {
  let server: ZipServer;
  let dataDirectory: string;
  let env: FakeHost;

  const plugin = (
    overrides: Record<string, any> = {},
    answer: Record<string, any> = {},
    downloadPath?: string,
  ): TestPlugin => {
    env = fakeHost(answer);
    const p = new TestPlugin({
      name: 'oracle-client',
      settings: { version: '23.9.0.25.07', ...overrides } as any,
      logger: undefined as any,
      dataDirectory,
      host: env.host,
    });
    p.downloadUrl = server.url(downloadPath);
    return p;
  };

  beforeEach(async () => {
    server = await zipServer(clientZip());
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-client-'));
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it('should refuse an engine that is older than plugin-api 2.2', async () => {
    const p = plugin();
    /* The engine of 2.0: no status, no questions, no workers' environment */
    const old = { engine: { version: '1.10.0', apiVersion: '2.0.4' } };
    Object.defineProperty(p, 'host', { value: old });
    await expect(p.activate()).rejects.toThrow('plugin-api 2.2 or newer');
    await expect(p.activate()).rejects.toThrow('2.0.4');
  });

  it('should refuse an engine of plugin-api 2.1, which grants no permissions', async () => {
    const p = plugin();
    const { host } = fakeHost();
    const old = { ...host, engine: { version: '1.11.0', apiVersion: '2.1.0' } };
    Object.defineProperty(p, 'host', { value: old });
    await expect(p.activate()).rejects.toThrow('plugin-api 2.2 or newer');
  });

  it('should ask the license, unpack the client and give it to the workers', async () => {
    const p = plugin();
    await p.activate();
    await waitFor(() => env.last()?.state === 'ready');
    expect(env.asked).toEqual(['license']);
    /* Under shared/, which the workers may read; the zip's own directory
     * dropped: the libraries sit in it */
    expect(p.clientDirectory).toBe(
      path.join(dataDirectory, 'shared', 'instantclient'),
    );
    expect(fs.existsSync(path.join(p.clientDirectory, 'libclntsh.so'))).toBe(
      true,
    );
    expect(env.environments).toEqual([
      {
        LD_LIBRARY_PATH: [p.clientDirectory],
        TNS_ADMIN: path.join(p.clientDirectory, 'network', 'admin'),
      },
    ]);
    expect(env.last()).toEqual({
      state: 'ready',
      message: 'Instant Client 23.9.0.25.07',
    });
  });

  it('should tell the progress of the download while it runs', async () => {
    const p = plugin();
    await p.activate();
    await waitFor(() => env.last()?.state === 'ready');
    const downloading = env.statuses.filter(s => s.message === 'Downloading');
    expect(downloading.length).toBeGreaterThan(1);
    expect(downloading.at(-1)?.progress).toBe(1);
  });

  it('should download nothing when the license is declined', async () => {
    const p = plugin({}, { choice: 'decline' });
    await p.activate();
    await waitFor(() => env.last()?.state === 'error');
    expect(server.requests).toEqual([]);
    expect(env.last()?.message).toContain("declined Oracle's license");
    expect(env.environments).toEqual([]);
  });

  it('should tell an address that answers 404', async () => {
    const p = plugin({}, {}, '/nowhere.zip');
    await p.activate();
    await waitFor(() => env.last()?.state === 'error');
    expect(env.last()?.message).toContain('404');
    expect(env.environments).toEqual([]);
  });

  it('should tell a download that is not an Instant Client package', async () => {
    const p = plugin({}, {}, '/garbage.zip');
    await p.activate();
    await waitFor(() => env.last()?.state === 'error');
    expect(env.last()?.message).toMatch(/not a zip file|no libclntsh/);
  });

  it('should refuse a download that does not match the checksum', async () => {
    const p = plugin({ sha256: 'f'.repeat(64) });
    await p.activate();
    await waitFor(() => env.last()?.state === 'error');
    expect(env.last()?.message).toContain('SHA-256');
    expect(fs.existsSync(p.clientDirectory)).toBe(false);
  });

  it('should tell the admin when the host has no libaio', async () => {
    const p = plugin();
    p.libaio = false;
    await p.activate();
    await waitFor(() => env.last()?.state === 'error');
    expect(env.last()?.message).toContain('libaio is not installed');
    /* Installed, but given to no worker: the client cannot load */
    expect(fs.existsSync(path.join(p.clientDirectory, 'libclntsh.so'))).toBe(
      true,
    );
    expect(env.environments).toEqual([]);
  });

  it("should tell the admin the link to make when the host has Ubuntu 24.04's libaio.so.1t64 alone", async () => {
    const p = plugin();
    p.libaio = '/usr/lib/x86_64-linux-gnu/libaio.so.1t64';
    await p.activate();
    await waitFor(() => env.last()?.state === 'error');
    expect(env.last()?.message).toContain(
      '"sudo ln -s libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1"',
    );
    /* The plugin changes nothing of the system, nor gives an unloadable client */
    expect(env.environments).toEqual([]);
  });

  it('should install from a zip on the server, without reaching Oracle', async () => {
    const zip = path.join(dataDirectory, 'from-file.zip');
    fs.writeFileSync(zip, clientZip());
    const p = plugin({}, {}, '/nowhere.zip');
    await p.activate();
    await waitFor(() => env.last()?.state === 'error');
    const action = env.actions.get('from-file')!;
    const result = await action.run({ source: zip });
    expect(result).toEqual({
      message: 'Instant Client 23.9.0.25.07 installed',
    });
    expect(server.requests).toEqual(['/nowhere.zip']);
    expect(env.last()?.state).toBe('ready');
  });

  it('should tell the file action a path that is not there', async () => {
    const p = plugin();
    await p.activate();
    await waitFor(() => env.last()?.state === 'ready');
    const action = env.actions.get('from-file')!;
    await expect(
      action.run({ source: path.join(dataDirectory, 'missing.zip') }),
    ).rejects.toThrow('There is no file at');
  });

  it('should take no address in the file action: it downloads from Oracle alone', async () => {
    const p = plugin();
    await p.activate();
    await waitFor(() => env.last()?.state === 'ready');
    const requests = server.requests.length;
    const action = env.actions.get('from-file')!;
    await expect(action.run({ source: server.url() })).rejects.toThrow(
      'There is no file at',
    );
    expect(server.requests.length).toBe(requests);
  });

  it('should ask the license again when "install" is run', async () => {
    const p = plugin();
    await p.activate();
    await waitFor(() => env.last()?.state === 'ready');
    await env.actions.get('install')!.run(undefined);
    expect(env.forgotten).toEqual(['license']);
    expect(env.asked).toEqual(['license', 'license']);
  });

  it('should take the client back on "remove", and tell the workers are owed a restart', async () => {
    const p = plugin();
    await p.activate();
    await waitFor(() => env.last()?.state === 'ready');
    const result = await env.actions.get('remove')!.run(undefined);
    expect(result).toEqual({ message: 'Instant Client removed' });
    expect(fs.existsSync(p.clientDirectory)).toBe(false);
    /* The engine marks a running worker; what the plugin does is take it back */
    expect(env.environments).toEqual([]);
    expect(env.last()).toEqual({
      state: 'attention',
      message: 'No Instant Client installed',
    });
  });

  it('should give what is installed again at the next start, asking Oracle for nothing', async () => {
    const first = plugin();
    await first.activate();
    await waitFor(() => env.last()?.state === 'ready');
    const requests = server.requests.length;
    const again = plugin();
    await again.activate();
    await waitFor(() => env.last()?.state === 'ready');
    expect(server.requests.length).toBe(requests);
    expect(env.environments.length).toBe(1);
  });

  it('should install the version of the settings at the next start when it changed', async () => {
    const first = plugin();
    await first.activate();
    await waitFor(() => env.last()?.state === 'ready');
    const requests = server.requests.length;
    const updated = plugin({ version: '23.26.4.0.0' });
    await updated.activate();
    await waitFor(() => env.last()?.message === 'Instant Client 23.26.4.0.0');
    expect(server.requests.length).toBe(requests + 1);
    expect(env.asked).toEqual(['license']);
  });

  it("should drop 1.1.0's client, which the workers may not read, when updated from it", () => {
    const old = path.join(dataDirectory, 'instantclient');
    fs.mkdirSync(old);
    fs.writeFileSync(path.join(old, 'libclntsh.so'), 'old');
    plugin().install({ from: '1.1.0', to: '1.1.1' });
    expect(fs.existsSync(old)).toBe(false);
  });

  it('should leave the workers the client they have when the update fails', async () => {
    const first = plugin();
    await first.activate();
    await waitFor(() => env.last()?.state === 'ready');
    const updated = plugin({ version: '23.26.4.0.0' }, {}, '/nowhere.zip');
    await updated.activate();
    await waitFor(() => env.last()?.state === 'error');
    expect(env.last()?.message).toContain('404');
    expect(env.last()?.message).toContain(
      'The workers keep Instant Client 23.9.0.25.07',
    );
    expect(env.environments.length).toBe(1);
    expect(
      fs.existsSync(path.join(updated.clientDirectory, 'libclntsh.so')),
    ).toBe(true);
  });
});
