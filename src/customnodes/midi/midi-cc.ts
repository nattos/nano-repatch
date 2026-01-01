import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { NumberType } from "../../structor/type-helpers";
import { MidiEvent } from "../../io/midi/types";

interface MidiStreamInput {
  stream: MidiEvent[];
}
interface MidiCcInputs extends MidiStreamInput { }

const MidiCcFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Channel', path: 'channel', min: 1, max: 16, step: 1 },
  { type: 'number', label: 'CC', path: 'cc', min: 0, max: 127, step: 1 }
];

// explicit 'any' to bypass constraint
export const midiCcNode = defineNode<any, { channel?: number, cc?: number }, { channel: typeof NumberType, cc: typeof NumberType }, any, { value: number }>({
  id: "midi.cc",
  version: "1.0.0",
  displayName: "MIDI CC",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'cc', 'control change'],
    description: 'Reads MIDI Control Change messages from a stream.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  config: {
    channel: numberType,
    cc: numberType,
  },
  outputs: {
    value: numberType
  },
  ui: { inspector: { fields: MidiCcFields } },
  createState: () => ({ value: 0 }),
  execute: (rawInputs: any, config, context, state) => {
    const inputs = rawInputs as MidiCcInputs;
    const channel = config.channel || 1;
    const targetCc = config.cc || 0;

    const stream = inputs.stream || [];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.type === 'cc' && event.channel === channel && event.cc === targetCc) {
          state.value = event.value / 127.0;
        }
      }
    }

    return { value: state.value };
  },
  compileConfig: (uiConfig) => ({
    channel: uiConfig.channel ?? 1,
    cc: uiConfig.cc ?? 0
  }),
});

registerNode(midiCcNode);
