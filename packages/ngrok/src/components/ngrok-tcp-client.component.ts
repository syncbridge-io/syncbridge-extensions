import { Buffer } from 'node:buffer';
import net from 'node:net';
import { clearTimeout } from 'node:timers';
import { updateErrorMessage } from '@jsopen/objects';
import ngrok from '@ngrok/ngrok';
import { IoClientBaseComponent } from '@syncbridge/builtins';
import { Component, ServiceStatus, WorkerPermission } from '@syncbridge/common';
import colors from 'ansi-colors';
import { splitString } from 'fast-tokenizer';
import { noOp } from '../constants.js';
import { NgrokTcpClientVariables } from './ngrok-tcp-client.variables.js';

@Component({
  displayName: 'Ngrok TCP Client Tunnel',
  description: 'Tcp client tunnel for Ngrok (https://ngrok.com)',
  /* A worker may load native code only when told: the ngrok SDK is a native addon */
  permissions: [WorkerPermission.NativeCodeExecute],
  summary:
    'Opens an ngrok TCP tunnel to the component, so a remote device can connect to it, and reads and writes its bytes.',
  tags: ['tcp', 'client', 'socket', 'connection', 'ngrok'],
})
export class NgrokTcpClientComponent<
  TEvents extends NgrokTcpClientComponent.Events =
    NgrokTcpClientComponent.Events,
> extends IoClientBaseComponent<TEvents> {
  readonly protocol: string = 'tcp';
  protected _ngrokListener?: ngrok.Listener;
  protected _server?: net.Server;
  protected _socket?: net.Socket;
  protected _stopping?: boolean;
  protected _reconnectTimer?: NodeJS.Timeout;
  /** Whether the tunnel is open: started and connected are told once */
  protected _tunnelUp = false;

  @Component.UseVariables()
  declare values: NgrokTcpClientVariables;

  /** The tunnel's address, once it is open */
  get peerAddress(): string | undefined {
    return this._ngrokListener?.url() || undefined;
  }

  get connected(): boolean {
    return !!this._socket;
  }

  protected async _init(): Promise<void> {
    await super._init();
    this.on('values-updated', () =>
      this._restart().catch(err =>
        this.setStatus(ServiceStatus.unhealthy, err.message),
      ),
    );
  }

  protected async _start(abortSignal: AbortSignal): Promise<void> {
    await super._start(abortSignal);
    this._stopping = false;
    this._tunnelUp = false;
    if (this._server) {
      this._server.close();
    }

    const onSocketData = (data: Buffer) => {
      this.emit('data', data);
    };

    const onSocketClose = () => {
      this._socket = undefined;
    };

    this._server = await createServer(this.values.localPort, socket => {
      // The last connected socket is ngrok agent, we will use it to read and write operations
      if (this._socket) {
        this._socket.off('data', onSocketData);
        this._socket.off('close', onSocketClose);
      }
      this._socket = socket;
      socket.on('data', onSocketData);
      socket.on('close', onSocketClose);
    }).catch(error => {
      updateErrorMessage(
        error,
        `Can't create local listener. ${error?.message}`,
      );
      throw error;
    });
    this._startNgrok(abortSignal).catch(noOp);
  }

  protected async _stop(): Promise<void> {
    this._stopping = true;
    this._tunnelUp = false;
    clearTimeout(this._reconnectTimer);
    if (this._ngrokListener) {
      this.logger?.debug('Disconnecting previous tunnel');
      await this._ngrokListener.close().catch(noOp);
      this._ngrokListener = undefined;
    }
    // The server waits for its sockets to end before it closes
    this._socket?.destroy();
    this._socket = undefined;
    if (this._server?.listening) {
      await new Promise<void>(resolve => {
        this._server!.close(() => resolve());
      }).catch(noOp);
      this._server = undefined;
    }
  }

  write(data: string | Buffer): void {
    if (!this.connected) {
      throw new Error(`Can't write while TCP socket is not connected`);
    }
    this.emit('transmit', data);
    this._socket?.write(data);
  }

  /** The tunnel is open: the component is started, and tells it once */
  protected _onTunnelUp() {
    if (this._tunnelUp) return;
    this._tunnelUp = true;
    this.setStatus(ServiceStatus.started);
    this.emit('connect');
  }

  protected async _startNgrok(abortSignal: AbortSignal) {
    this.logger?.trace('Starting Ngrok tunnel');
    clearTimeout(this._reconnectTimer);
    /** Close previous tunnels */
    if (this._ngrokListener) {
      this.logger?.debug('Disconnecting previous tunnel');
      await this._ngrokListener.close().catch(noOp);
    }
    this._ngrokListener = undefined;
    let tries = -1;
    /*  */
    const _ngrokStatusChange = (status: string) => {
      if (status === 'closed') {
        this._tunnelUp = false;
        if (this._stopping) this.emit('disconnect');
        else {
          const error = new Error('Ngrok tunnel disconnected');
          this.setStatus(ServiceStatus.unhealthy, error.message);
          this.emit('disconnect', error);
        }
        return;
      }
      if (status === 'connected') {
        tries = -1;
        if (this._ngrokListener) {
          this.logger?.info(
            `Ngrok tunnel reconnected: ${colors.cyan(this._ngrokListener.url()!)}`,
          );
        }
        this._onTunnelUp();
      }
    };

    /*  */
    const _ngrokLogEvent = (event: string) => {
      if (this._stopping) return;
      const log = parseNgrokLog(event);
      if (log.msg?.includes(' not yet ')) return;
      if (log.lvl === 'warn') {
        if (log.err) this.logger?.error(log.err);
      } else if (log.lvl === 'error') {
        this.logger?.error(log.msg);
      } else this.logger?.debug(`lvl=${log.lvl} | ${log.msg}`);
    };

    const { port } = this._server!.address() as net.AddressInfo;
    /** Create the tunnel */
    try {
      this.logger?.debug(`Creating Ngrok tunnel`);
      const listener = await ngrok.forward({
        proto: 'tcp',
        authtoken: this.values.authToken,
        addr: port,
        onStatusChange: _ngrokStatusChange,
        onLogEvent: _ngrokLogEvent,
      });
      // Stopped while the tunnel was being opened: nothing would close it
      if (this._stopping || abortSignal?.aborted) {
        await listener.close().catch(noOp);
        return;
      }
      this._ngrokListener = listener;
      this._onTunnelUp();
      this.logger?.info(
        `Ngrok tunnel connected: ${colors.blueBright(this._ngrokListener.url()!)}`,
      );
    } catch (err: any) {
      if (this._stopping || abortSignal?.aborted) return;
      tries++;
      this.logger?.error(
        `Can't create Ngrok tunnel. ${err?.message}\n` +
          `  Retry attempt (${colors.cyan(String(tries))}) will be made in ${colors.cyan('5 secs')}`,
      );
      this.setStatus(
        ServiceStatus.unhealthy,
        `Can't create Ngrok tunnel. ${err?.message}`,
      );
      this._reconnectTimer = setTimeout(() => {
        this._startNgrok(abortSignal).catch(noOp);
      }, 5000);
      return;
    }
  }
}

/**
 /**
 * @namespace
 */
export namespace NgrokTcpClientComponent {
  export interface Events extends IoClientBaseComponent.Events {
    connect: [];
    disconnect: [error: Error | undefined];
    data: [data: Buffer];
    reconnecting: [n: number, delay: number];
  }

  export const Variables = NgrokTcpClientVariables;
  export type Variables = NgrokTcpClientVariables;
}

/**
 * Creates and initializes a server instance on the first available port within the specified range.
 */
function createServer(
  port = 0,
  connectionListener: (socket: net.Socket) => void,
): Promise<net.Server> {
  return new Promise<net.Server>((resolve, reject) => {
    const server = net.createServer(connectionListener);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function parseNgrokLog(line: string): any {
  const splitted = splitString(line, {
    delimiters: ' ',
    keepQuotes: true,
    quotes: true,
  });
  return splitted.reduce((a, s) => {
    const v = splitString(s, {
      delimiters: '=',
      keepQuotes: false,
      quotes: true,
    });
    a[v[0]] = v[1];
    return a;
  }, {});
}
