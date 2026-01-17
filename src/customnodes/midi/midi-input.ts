import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { NumberType } from "../../structor/type-helpers";
import { MidiEvent } from "../../io/midi/types";

const MidiInputFields: InspectorFieldDef[] = [
  { type: 'string', label: 'Device ID', path: 'deviceId', placeholder: 'Optional Device ID' }
];

const MidiCcInputFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Channel', path: 'channel', min: 1, max: 16, step: 1 },
  { type: 'number', label: 'CC', path: 'cc', min: 0, max: 127, step: 1 },
  { type: 'string', label: 'Device ID', path: 'deviceId', placeholder: 'Optional Device ID' }
];

// strict type inference
export const midiInputNode = defineNode({
  id: "midi.input",
  version: "1.0.0",
  displayName: "MIDI Input",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'input', 'source'],
    description: 'Reads raw MIDI messages from a specific device.'
  },
  inputs: {},
  config: {
    deviceId: { kind: 'atomic', type: 'string', optional: true }
  },
  outputs: {
    stream: midiStreamType
  },
  ui: { inspector: { fields: MidiInputFields } },
  isRealtime: () => true,
  usesMidiDeviceIO: () => true,
  execute: (inputs, config, context) => {
    const midiEvents = context.midi?.events as MidiEvent[] | undefined;
    const deviceId = config.deviceId;

    if (midiEvents && deviceId) {
      // Filter by device ID
      const filtered = midiEvents.filter(e => e.deviceId === deviceId);
      return { stream: filtered };
    }

    return { stream: midiEvents || [] };
  },
  compileConfig: (uiConfig: { deviceId?: string }) => ({
    deviceId: uiConfig.deviceId
  }),
});

// strict type inference
export const midiCcInputNode = defineNode({
  id: "midi.cc.input",
  version: "1.0.0",
  displayName: "MIDI CC Input",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'cc', 'input'],
    description: 'Reads a MIDI CC value directly from the environment.'
  },
  inputs: {},
  config: {
    channel: numberType,
    cc: numberType,
    deviceId: { kind: 'atomic', type: 'string', optional: true }
  },
  outputs: {
    value: numberType
  },
  ui: { inspector: { fields: MidiCcInputFields } },
  isRealtime: () => true,
  usesMidiDeviceIO: () => true,
  execute: (inputs, config, context) => {
    const channel = config.channel || 1;
    const cc = config.cc || 0;
    const deviceId = config.deviceId;

    const key = `${channel}:${cc}`;
    const value = context.midi?.values.get(key) ?? 0;

    return { value };
  },
  compileConfig: (uiConfig: { channel?: number, cc?: number, deviceId?: string }) => ({
    channel: uiConfig.channel ?? 1,
    cc: uiConfig.cc ?? 0,
    deviceId: uiConfig.deviceId
  }),
});

registerNode(midiInputNode);
registerNode(midiCcInputNode);
