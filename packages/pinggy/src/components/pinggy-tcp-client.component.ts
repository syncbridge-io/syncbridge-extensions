import { Buffer } from 'node:buffer';
import net from 'node:net';
import { clearInterval, clearTimeout } from 'node:timers';
import { updateErrorMessage } from '@jsopen/objects';
import { pinggy, TunnelInstance } from '@pinggy/pinggy';
import { IoClientBaseComponent } from '@syncbridge/builtins';
import { Component, ServiceStatus, WorkerPermission } from '@syncbridge/common';
import colors from 'ansi-colors';
import { noOp } from '../constants.js';
import { PinggyTcpClientVariables } from './pinggy-tcp-client.variables.js';

@Component({
  displayName: 'Pinggy Tcp Tunnel Client',
  description:
    'A Tcp client component which creates a tunnel using Pinggy (https://pinggy.io)',
  /* A worker may load native code only when told: the Pinggy SDK is a native addon */
  permissions: [WorkerPermission.NativeCodeExecute],
  summary:
    'Opens a Pinggy TCP tunnel to the component, so a remote device can connect to it, and reads and writes its bytes.',
  tags: ['tcp', 'client', 'socket', 'connection', 'pinggy', 'tunnel'],
})
export class PinggyTcpClientComponent<
  TEvents extends PinggyTcpClientComponent.Events =
    PinggyTcpClientComponent.Events,
> extends IoClientBaseComponent<TEvents> {
  readonly protocol: string = 'tcp';
  protected _tunnel?: TunnelInstance;
  /** The tunnel's addresses, once it is open */
  protected _urls?: string[];
  protected _tunnelHealthcheckTimer?: NodeJS.Timeout;
  protected _server?: net.Server;
  protected _socket?: net.Socket;
  protected _stopping?: boolean;
  protected _reconnectTimer?: NodeJS.Timeout;
  protected _retries: number = 0;
  /** Whether the tunnel is open: started and connected are told once */
  protected _tunnelUp = false;

  @Component.UseVariables()
  declare values: PinggyTcpClientVariables;

  get peerAddress(): string | undefined {
    return this._urls?.length ? `tcp://${this._urls.join(', ')}` : undefined;
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

    this._retries = 0;
    this._server = await createServer(this.values.localPort, socket => {
      // The last connected socket is tunnel agent, we will use it to read and write operations
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
    this._startPinggy().catch(noOp);
  }

  protected async _stop(): Promise<void> {
    this._stopping = true;
    this._tunnelUp = false;
    clearInterval(this._tunnelHealthcheckTimer);
    clearTimeout(this._reconnectTimer);
    this._urls = undefined;
    // The server waits for its sockets to end before it closes
    this._socket?.destroy();
    this._socket = undefined;
    if (this._tunnel) {
      this.logger?.debug('Disconnecting previous tunnel');
      try {
        await this._tunnel.stop();
      } catch (err: any) {
        this.logger?.error(err);
      }
      this._tunnel = undefined;
    }
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

  protected async _startPinggy() {
    /** Close previous tunnels */
    if (this._tunnel) {
      this.logger?.debug('Closing previous tunnel');
      await this._tunnel.stop().catch(noOp);
    }
    this._tunnel = undefined;
    const { port } = this._server!.address() as net.AddressInfo;
    /** Create the tunnel */
    try {
      this.logger?.debug(`Creating tcp tunnel`);
      const tunnel = await pinggy.forward({
        token: this.values.authToken,
        forwarding: 'tcp://localhost:' + port,
        autoReconnect: true,
        reconnectInterval: 5,
        maxReconnectAttempts: Number.MAX_SAFE_INTEGER,
      });
      // Stopped while the tunnel was being opened: nothing would close it
      if (this._stopping) {
        await tunnel.stop().catch(noOp);
        return;
      }
      this._tunnel = tunnel;
      this._retries = 0;
      tunnel.setTunnelErrorCallback(payload => {
        const { errorNo, error, recoverable } = payload;
        const err: any = new Error(error);
        err.code = errorNo;
        err.recoverable = recoverable;
        this.emit('error', err);
        if (!recoverable && !this._stopping) {
          clearTimeout(this._reconnectTimer);
          this._reconnectTimer = setTimeout(() => {
            this._startPinggy().catch(noOp);
          }, 1000);
        }
      });

      const urls = await tunnel.urls();
      this._urls = urls;
      await this.tunnelHealthCheck();
      this._onTunnelUp();
      this.logger?.info(
        `Tunnel started: tcp://${colors.blueBright(urls.join(', '))}`,
      );
    } catch (err: any) {
      if (this._stopping) return;
      this._retries++;
      this.logger?.error(
        `Can't create tunnel. ${err?.message}\n` +
          `  Retry attempt (${colors.cyan(String(this._retries))}) will be made in ${colors.cyan('5 secs')}`,
      );
      this.setStatus(
        ServiceStatus.unhealthy,
        `Can't create tunnel. ${err?.message}`,
      );
      this._reconnectTimer = setTimeout(() => {
        this._startPinggy().catch(noOp);
      }, 5000);
      return;
    }
  }

  /** The tunnel is open: the component is started, and tells it once */
  protected _onTunnelUp() {
    if (this._tunnelUp) return;
    this._tunnelUp = true;
    this.setStatus(ServiceStatus.started);
    this.emit('connect');
  }

  protected async tunnelHealthCheck() {
    // c8 ignore next
    if (!this._tunnel) return;
    clearInterval(this._tunnelHealthcheckTimer);
    let lastStatus = await this._tunnel.getStatus();
    this._tunnelHealthcheckTimer = setInterval(() => {
      if (!this._tunnel) {
        clearInterval(this._tunnelHealthcheckTimer);
        return;
      }
      this._tunnel!.getStatus()
        .then(async status => {
          if (status !== lastStatus) {
            lastStatus = status;
            await this._tunnelStatusChanged(status);
          }
        })
        .catch(e => this.emit('error', e));
    }, 100).unref();
  }

  protected async _tunnelStatusChanged(status: string) {
    if (status === 'closed') {
      this._tunnelUp = false;
      if (this._stopping) this.emit('disconnect');
      else {
        const error = new Error('Tunnel disconnected');
        this.setStatus(ServiceStatus.unhealthy, error.message);
        this.emit('disconnect', error);
      }
      return;
    }
    if (status === 'live' && this._tunnel) {
      this._retries = 0;
      const urls = await this._tunnel.urls();
      this.logger?.info(`Tunnel reconnected: ${colors.cyan(urls.join(', '))}`);
      this._onTunnelUp();
    }
  }
}

/**
 /**
 * @namespace
 */
export namespace PinggyTcpClientComponent {
  export interface Events extends IoClientBaseComponent.Events {
    connect: [];
    disconnect: [error: Error | undefined];
    data: [data: Buffer];
    reconnecting: [n: number, delay: number];
  }

  export const Variables = PinggyTcpClientVariables;
  export type Variables = PinggyTcpClientVariables;
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
