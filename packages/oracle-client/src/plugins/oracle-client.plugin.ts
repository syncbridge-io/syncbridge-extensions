import { createHash } from 'node:crypto';
import fs, { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DefineVariable, PluginPermission } from '@syncbridge/common';
import { Plugin, PluginBase, type PluginHost } from '@syncbridge/plugin-api';
import { CLIENT_DIR, INSTALL_RECORD, SHARED_DIR } from '../constants.js';
import { downloadUrlOf } from '../utils/download-url.js';
import { findLibaio, LIBAIO_MISSING, libaioT64Only } from '../utils/libaio.js';
import { unpackClient } from '../utils/unpack.js';
import { OracleClientSettings } from './oracle-client.variables.js';

/** The form of the "from-file" action */
export class InstallFromFileInput {
  @DefineVariable({
    label: 'Zip',
    description: "The Basic package's path on this server",
    required: true,
  })
  declare source: string;
}

/** What the plugin keeps beside the client it installed */
interface InstallRecord {
  version: string;
  source: string;
  installedAt: string;
}

/**
 * Installs Oracle Instant Client on the server and gives it to the workers.
 *
 * Oracle 11 answers in Thick mode alone, which needs Instant Client, and
 * Oracle's license does not let SyncBridge carry it in its image or its
 * package - so an admin accepts the license here and the plugin downloads
 * it from Oracle.
 */
@Plugin({
  name: 'oracle-client',
  title: 'Oracle Instant Client',
  description:
    "Downloads Oracle Instant Client, once an admin has accepted Oracle's license, and adds it to every worker's environment",
  settings: OracleClientSettings,
  /* The client to the workers, Oracle's download, and `ldconfig` asked for
   * libaio */
  permissions: [
    PluginPermission.WorkerEnvironment,
    PluginPermission.Network,
    PluginPermission.ChildProcesses,
  ],
  hosts: ['download.oracle.com'],
})
export class OracleClientPlugin extends PluginBase<OracleClientSettings> {
  protected _removeActions: (() => void)[] = [];
  protected _removeEnvironment?: () => void;
  /** One install at a time, whichever action asked for it */
  protected _installing?: Promise<InstallRecord>;

  get clientDirectory(): string {
    return path.join(this.dataDirectory, SHARED_DIR, CLIENT_DIR);
  }

  /**
   * 1.1.0 unpacked the client beside its record, where the workers may not
   * read it: that one is dropped, and the client installed again under
   * `shared/` as the plugin starts
   */
  install({ from }: PluginBase.Install): void {
    if (from)
      fs.rmSync(path.join(this.dataDirectory, CLIENT_DIR), {
        recursive: true,
        force: true,
      });
  }

  async activate(): Promise<void> {
    this._needsPluginApi22();
    this._registerActions();
    /* The engine waits for activate, and the license is answered by a person:
     * the question and the download are told through the status instead */
    void this._bringUp();
  }

  async deactivate(): Promise<void> {
    /* The engine undoes what was registered; an install still running is
     * left to finish into a directory nothing reads any more */
    this._removeActions.splice(0);
    this._removeEnvironment = undefined;
  }

  /**
   * The engine tells a plugin the plugin-api version it has itself, and
   * refuses a plugin whose peer range it does not satisfy - but an engine
   * older than 2.2 that reaches here anyway does not give a plugin the
   * permissions it declares, nor has a 2.0 one the status, questions and
   * workers' environment this plugin talks through. Said plainly, on its
   * card, rather than failing at the first call.
   */
  protected _needsPluginApi22(): void {
    /* The types promise it; an engine built on 2.0 may not tell it */
    const apiVersion = (this.host as Partial<PluginHost>).engine?.apiVersion;
    const [major, minor] = (apiVersion || '0.0').split('.').map(Number);
    if (major > 2 || (major === 2 && minor >= 2)) return;
    throw new Error(
      'This plugin needs a SyncBridge built on @syncbridge/plugin-api 2.2 or newer: ' +
        `this one provides ${apiVersion || 'an older API'}, which does not grant a plugin its permissions. Update SyncBridge.`,
    );
  }

  /**
   * The license, then the client: installed already, or downloaded. A client
   * of another version than the settings' is given meanwhile and replaced,
   * so changing the version and restarting is how it is updated.
   */
  protected async _bringUp(): Promise<void> {
    const installed = this._installed();
    try {
      if (!(await this._licenseAccepted())) return;
      if (installed) this._give(installed);
      if (installed?.version !== this.settings.version) await this._install();
    } catch (err: any) {
      this.logger?.error(err);
      /* The unpacking replaces the old client last: a failed update leaves
       * it whole, and the workers keep it */
      const message =
        installed && this._removeEnvironment
          ? `${err.message}. The workers keep Instant Client ${installed.version}`
          : err.message;
      this.host.status.set({ state: 'error', message });
    }
  }

  /**
   * Oracle's license, asked once: the engine keeps the answer, so a restart
   * does not ask again. Declined, the plugin does nothing and says so.
   */
  protected async _licenseAccepted(askAgain?: boolean): Promise<boolean> {
    if (askAgain) this.host.ui.forget('license');
    const answer = await this.host.ui.ask({
      id: 'license',
      title: "Oracle's license",
      text:
        'Instant Client is downloaded from Oracle and installed on this server under Oracle Technology Network terms. ' +
        'SyncBridge may not carry it, which is why it is installed here.',
      link: {
        label: "Read Oracle's license",
        url: 'https://www.oracle.com/downloads/licenses/instant-client-lic.html',
      },
      choices: [
        { value: 'accept', label: 'Accept', primary: true },
        { value: 'decline', label: 'Decline' },
      ],
    });
    if (answer.choice === 'accept') return true;
    this.host.status.set({
      state: 'error',
      message: `${answer.by} declined Oracle's license: no client is installed and the workers are given none. "Install now" asks again.`,
    });
    return false;
  }

  /** The client in the data directory, as its record tells it */
  protected _installed(): InstallRecord | undefined {
    const record = path.join(this.dataDirectory, INSTALL_RECORD);
    if (!fs.existsSync(record) || !fs.existsSync(this.clientDirectory))
      return undefined;
    try {
      return JSON.parse(fs.readFileSync(record, 'utf8')) as InstallRecord;
    } catch {
      /* A record nobody can read is no record: install again */
      return undefined;
    }
  }

  /** The client's directory to every worker, and the version on its card */
  protected _give(record: InstallRecord): void {
    const libaio = this._findLibaio();
    if (libaio !== true) {
      /* A client the workers cannot load is not given to them */
      const message = libaio ? libaioT64Only(libaio) : LIBAIO_MISSING;
      this.host.status.set({ state: 'error', message });
      return;
    }
    this._removeEnvironment?.();
    this._removeEnvironment = this.host.workers.addEnvironment({
      LD_LIBRARY_PATH: [this.clientDirectory],
      TNS_ADMIN: path.join(this.clientDirectory, 'network', 'admin'),
    });
    this.host.status.set({
      state: 'ready',
      message: `Instant Client ${record.version}`,
    });
  }

  /** The host's libaio, which a test plays */
  protected _findLibaio(): boolean | string {
    return findLibaio();
  }

  /** Downloads and unpacks, one at a time; `source` for the file action */
  protected _install(source?: string): Promise<InstallRecord> {
    if (this._installing) return this._installing;
    this._installing = this._installNow(source).finally(
      () => (this._installing = undefined),
    );
    return this._installing;
  }

  protected async _installNow(source?: string): Promise<InstallRecord> {
    const { version } = this.settings;
    const zip = path.join(this.dataDirectory, 'download.zip');
    fs.mkdirSync(this.dataDirectory, { recursive: true });
    /* The workers run as users of their own: they pass through it */
    const shared = path.dirname(this.clientDirectory);
    fs.mkdirSync(shared, { recursive: true });
    fs.chmodSync(shared, 0o755);
    try {
      if (source) {
        if (!this._present(source))
          throw new Error(`There is no file at "${source}" on this server`);
        this.host.status.set({ state: 'busy', message: `Reading ${source}` });
        fs.copyFileSync(source, zip);
      } else {
        await this._download(this._downloadUrl(version), zip);
      }
      if (this.settings.sha256) this._verify(zip, this.settings.sha256);
      this.host.status.set({ state: 'busy', message: 'Unpacking' });
      unpackClient(zip, this.clientDirectory);
      const record: InstallRecord = {
        version,
        source: source || 'oracle.com',
        installedAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(this.dataDirectory, INSTALL_RECORD),
        JSON.stringify(record, null, 2),
      );
      this.logger?.info(
        `Instant Client ${version} installed in ${this.clientDirectory}`,
      );
      this._give(record);
      return record;
    } finally {
      fs.rmSync(zip, { force: true });
    }
  }

  /**
   * Whether the file action's zip is there. The engine lets a plugin read
   * its data directory alone, and `existsSync` throws on a path outside it:
   * the admin is told where to copy the zip instead.
   */
  protected _present(source: string): boolean {
    try {
      return fs.existsSync(source);
    } catch (err: any) {
      if (err.code !== 'ERR_ACCESS_DENIED') throw err;
      throw new Error(
        `This plugin may read only its own directory, not "${source}": copy the zip into ${this.dataDirectory} and give that path`,
        { cause: err },
      );
    }
  }

  /** Oracle's address of the version, for this server's architecture */
  protected _downloadUrl(version: string): string {
    return downloadUrlOf(version, process.arch);
  }

  /** The download, its progress on the card while it runs */
  protected async _download(url: string, target: string): Promise<void> {
    this.host.status.set({
      state: 'busy',
      message: 'Downloading',
      progress: 0,
    });
    this.logger?.info(`Downloading Instant Client from ${url}`);
    const response = await fetch(url);
    if (!response.ok || !response.body)
      throw new Error(
        `Downloading ${url} failed: ${response.status} ${response.statusText}`,
      );
    const total = Number(response.headers.get('content-length')) || 0;
    let received = 0;
    const body = Readable.fromWeb(response.body as any);
    body.on('data', (chunk: Buffer) => {
      received += chunk.length;
      this.host.status.set({
        state: 'busy',
        message: 'Downloading',
        ...(total ? { progress: received / total } : undefined),
      });
    });
    await pipeline(body, createWriteStream(target));
  }

  protected _verify(zip: string, expected: string): void {
    const sum = createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    if (sum.toLowerCase() !== expected.trim().toLowerCase())
      throw new Error(
        `The download does not match the SHA-256 in the settings: ${sum}`,
      );
  }

  protected _registerActions(): void {
    this._removeActions.push(
      this.host.ui.registerAction({
        name: 'install',
        label: 'Install now',
        description:
          "Downloads the client again from Oracle. It also asks Oracle's license again when it was declined",
        confirm: 'Download Instant Client and replace what is installed?',
        run: async () => {
          if (!(await this._licenseAccepted(true)))
            return { message: "Oracle's license was declined" };
          const record = await this._install();
          return { message: `Instant Client ${record.version} installed` };
        },
      }),
      this.host.ui.registerAction<InstallFromFileInput>({
        name: 'from-file',
        label: 'Install from file',
        description:
          'For a server that does not reach Oracle: the zip downloaded elsewhere and copied here, by its path',
        input: InstallFromFileInput,
        run: async ({ source }) => {
          if (!(await this._licenseAccepted()))
            return { message: "Oracle's license was declined" };
          const record = await this._install(source);
          return { message: `Instant Client ${record.version} installed` };
        },
      }),
      this.host.ui.registerAction({
        name: 'remove',
        label: 'Remove',
        description:
          'Deletes the client. The workers keep it until they restart',
        confirm:
          'Remove Instant Client? A worker that needs it fails once it restarts.',
        danger: true,
        run: () => {
          this._removeEnvironment?.();
          this._removeEnvironment = undefined;
          fs.rmSync(this.clientDirectory, { recursive: true, force: true });
          fs.rmSync(path.join(this.dataDirectory, INSTALL_RECORD), {
            force: true,
          });
          this.host.status.set({
            state: 'attention',
            message: 'No Instant Client installed',
          });
          return { message: 'Instant Client removed' };
        },
      }),
    );
  }
}
