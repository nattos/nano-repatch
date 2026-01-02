import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { NumberType } from "../../structor/type-helpers";
import { MidiEvent } from "../../io/midi/types";

interface MidiStreamInput {
  stream: MidiEvent[];
}
interface MidiNoteInputs extends MidiStreamInput { }

const MidiNoteFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Channel', path: 'channel', min: 1, max: 16, step: 1 },
  { type: 'number', label: 'Note', path: 'note', min: 0, max: 127, step: 1 }
];

// strict type inference
export const midiNoteNode = defineNode({
  id: "midi.note",
  version: "1.0.0",
  displayName: "MIDI Note",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'note', 'keyboard'],
    description: 'Reads MIDI Note messages from a stream.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  config: {
    channel: numberType,
    note: numberType,
  },
  outputs: {
    note: { kind: 'atomic', type: 'number', optional: true },
    velocity: numberType,
    gate: numberType
  },
  ui: { inspector: { fields: MidiNoteFields } },
  createState: (): { velocity: number, gate: number } => ({ velocity: 0, gate: 0 }),
  execute: (inputs, config, context, state) => {
    // Inputs are strictly typed
    const channel = config.channel || 1;
    const targetNote = config.note || 60;

    const stream = (inputs.stream || []) as MidiEvent[];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.channel === channel) {
          if (event.type === 'note_on' && event.note === targetNote) {
            state.velocity = (event.velocity ?? 0);
            state.gate = 1;
          } else if (event.type === 'note_off' && event.note === targetNote) {
            state.gate = 0;
          }
        }
      }
    }

    return {
      note: state.gate ? targetNote : null,
      velocity: state.velocity,
      gate: state.gate
    };
  },
  compileConfig: (uiConfig: { channel?: number, note?: number }) => ({
    channel: uiConfig.channel ?? 1,
    note: uiConfig.note ?? 60
  }),
});

registerNode(midiNoteNode);
