import {
  DefineVariable,
  EnumSource,
  PACKET_CAPTURE_SNAP_LENGTH,
} from '@syncbridge/common';
import { IoClientBaseComponent } from './io-client-base.component.js';

/**
 * Variables
 */
export class PacketCaptureVariables extends IoClientBaseComponent.Variables {
  @DefineVariable({
    label: 'Interface',
    description:
      "The network interface to capture, such as a switch's port-mirror port",
    enumSource: EnumSource.NetworkInterfaces,
    required: true,
    index: 100,
  })
  declare interface: string;

  @DefineVariable({
    label: 'Filter',
    description:
      'Which frames to capture, as a BPF filter: "udp port 24000". Empty captures every frame. An admin approves the interface and this filter',
    index: 101,
  })
  declare filter?: string;

  @DefineVariable({
    label: 'Promiscuous',
    description:
      'Capture frames addressed to other machines too, as a mirror port carries them',
    default: true,
    index: 102,
  })
  declare promiscuous: boolean;

  @DefineVariable({
    label: 'Snapshot length',
    description: 'Bytes of each frame kept; the rest is cut',
    default: PACKET_CAPTURE_SNAP_LENGTH,
    minValue: 64,
    maxValue: 262144,
    index: 103,
  })
  declare snapLength: number;
}
