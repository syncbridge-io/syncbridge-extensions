import { Buffer } from 'node:buffer';
import EventEmitter from 'node:events';
import type { PortInfo } from '@serialport/bindings-interface';
import { IoClientBaseComponent } from '@syncbridge/builtins';
import { Component, ServiceStatus, WorkerPermission } from '@syncbridge/common';
import colors from 'ansi-colors';
import { toIntDef } from 'putil-varhelpers';
import reconnectCore from 'reconnect-core';
import { SerialPort } from 'serialport';
import { noOp } from '../constants.js';
import {
  SerialClientReconnectVariables,
  SerialClientVariables,
} from './serial-client.variables.js';

@Component({
  className: 'SerialPort',
  displayName: 'Serial Port',
  description: 'Serial port connection component',
  summary:
    'Opens a serial port, opens it again when the device returns, and reads and writes its bytes.',
  tags: ['serial', 'rs232', 'client', 'connection'],
  /* A worker runs as a user of its own: opening a port needs the first,
   * and the serialport package is a native addon */
  permissions: [WorkerPermission.SerialPorts, WorkerPermission.NativeCode],
})
export class SerialClientComponent<
  TEvents extends SerialClientComponent.Events = SerialClientComponent.Events,
> extends IoClientBaseComponent<TEvents> {
  readonly protocol: string = 'serial';
  protected _connectionManager?: ReturnType<typeof socketReconnect>;
  protected _serialPort?: SerialPort;
  protected _stopping?: boolean;

  @Component.UseVariables()
  declare values: SerialClientVariables;

  get connected(): boolean {
    return this._connectionManager?.connected ?? false;
  }

  get peerAddress(): string | undefined {
    return this.values.port || undefined;
  }

  /** The port and its framing, as a serial line is written: `9600 8N1` */
  protected get _glanceText(): string | undefined {
    const { port, baudRate, dataBits, parity, stopBits } = this.values;
    if (!port) return;
    const p = (parity || 'none')[0].toUpperCase();
    return `${port} ${baudRate} ${dataBits || 8}${p}${stopBits || 1}`;
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
    let reconnecting = false;
    this._connectionManager = socketReconnect({
      ...this.values.reconnect,
    })
      .on('error', err => {
        this.emit('error', err);
      })
      .on('connect', (emitter: any) => {
        const serialPort = emitter.port;
        if (this._serialPort !== serialPort) {
          this._serialPort = serialPort;
          serialPort.on('data', (chunk: Buffer) => this.emit('data', chunk));
        }
        if (reconnecting) this.emit('reconnect');
        reconnecting = false;
        this.emit('connect');
        this.logger?.info(
          `Connected to "${colors.cyan(this.values.port!)}" serial port`,
        );
        this.setStatus(ServiceStatus.started);
      })
      .on('reconnect', (n, delay) => {
        if (n === 0 && delay === 0) return;
        reconnecting = true;
        this.logger?.warn(
          `Connection failed (${colors.cyan(String(n + 1))}). Will be retried after ${colors.cyan(delay + 'ms')}`,
        );
        this.emit('reconnecting', n, delay);
      })
      .on('disconnect', err => {
        this._serialPort = undefined;
        if (this._stopping) this.emit('disconnect');
        else {
          // A device that goes away is written to the communication channel
          this.emit('disconnect', err);
          this.logger?.info(
            `Serial port "${colors.cyan(this.values.port!)}" disconnected`,
          );
          this.setStatus(
            ServiceStatus.unhealthy,
            err?.message || 'Disconnected',
          );
        }
      });

    this.logger?.info(
      `Connecting to serial port ${colors.cyan(this.values.port!)} ...`,
    );
    this._connectionManager.connect({
      path: this.values.port,
      baudRate: this.values.baudRate || 9600,
      dataBits: toIntDef(this.values.dataBits, 8),
      stopBits: (Number(this.values.stopBits) || 1) as 1 | 1.5 | 2,
      parity: this.values.parity || 'none',
      rtscts: this.values.rtscts,
      xon: this.values.xon,
      xoff: this.values.xoff,
      xany: this.values.xany,
      hupcl: this.values.hupcl,
    });
  }

  protected async _stop(): Promise<void> {
    if (!this._connectionManager) return;
    this._stopping = true;
    const connectionManager = this._connectionManager;
    this._connectionManager = undefined;
    /** istanbul ignore else */
    if (connectionManager.connected) {
      return new Promise(resolve => {
        connectionManager.once('disconnect', async () => {
          await this.emitAsync('stop').catch(noOp);
          resolve();
        });
        connectionManager.disconnect();
        connectionManager.reset();
      });
    } else {
      connectionManager.disconnect();
      connectionManager.reset();
    }
  }

  write(data: string | Buffer): void {
    if (!(this._serialPort && this._connectionManager?.connected)) {
      throw new Error(`Can't write while serial port is not connected`);
    }
    this.emit('transmit', data);
    this._serialPort.write(data);
  }

  async list(): Promise<PortInfo[]> {
    return await SerialPort.list();
  }
}

/**
 * A serial port as reconnect-core expects a connection: `connect` when it
 * is open, `close` when it closes or the device goes away, `error`, and
 * `end()` to close it.
 */
const socketReconnect = reconnectCore<any, any>(args => {
  const port = new SerialPort({
    ...args,
    autoOpen: false,
  });

  const emitter: any = new EventEmitter();
  emitter.end = () => {
    if (port.isOpen) port.close();
    else emitter.emit('close');
  };

  port.on('open', () => {
    emitter.port = port;
    emitter.emit('connect', port);
  });

  port.on('error', err => {
    emitter.emit('error', err);
  });

  port.on('close', (err?: Error) => {
    emitter.emit('close', err);
  });

  port.open(err => {
    if (err) {
      emitter.emit('error', err);
    }
  });

  return emitter;
});

/**
 * @namespace
 */
export namespace SerialClientComponent {
  export interface Events extends IoClientBaseComponent.Events {
    connect: [];
    disconnect: [error: Error | undefined];
    data: [data: Buffer];
    reconnecting: [n: number, delay: number];
    reconnect: [];
    write: [data: Buffer | string];
  }

  export const Variables = SerialClientVariables;
  export type Variables = SerialClientVariables;
  export const ReconnectVariables = SerialClientReconnectVariables;
  export type ReconnectVariables = SerialClientReconnectVariables;
}
