import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";

interface MidiStreamInput {
  stream: MidiEvent[];
}
interface MidiFilterInputs extends MidiStreamInput {
  channel?: number;
  note?: number;
}

const MidiNoteFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Channel', path: 'channel', min: 1, max: 16, step: 1 },
  { type: 'number', label: 'Note', path: 'note', min: 0, max: 127, step: 1 }
];

// midi.filter: uses inputs, config is empty
// explicit 'any' to bypass constraint
export const midiFilterNode = defineNode<any, { channel?: number, note?: number }, {}>({
  id: "midi.filter",
  version: "1.0.0",
  displayName: "MIDI Filter",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'filter', 'note'],
    description: 'Filters MIDI events, allowing only specific Note On/Off messages through.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true },
    channel: { type: numberType, description: 'MIDI Channel (1-16)', defaultValue: 1 },
    note: { type: numberType, description: 'Note Number (0-127)', defaultValue: 60 }
  },
  config: {},
  outputs: {
    stream: midiStreamType
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  ui: { inspector: { fields: MidiNoteFields } }, // Reuse MidiNoteFields
  execute: (rawInputs: any, config: any) => {
    const inputs = rawInputs as MidiFilterInputs;
    const channel = (inputs.channel as number) ?? 1;
    const targetNote = (inputs.note as number) ?? 60;
    const stream = inputs.stream || [];

    const filteredStream: MidiEvent[] = [];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.channel === channel) {
          if (event.type === 'note_on' || event.type === 'note_off') {
            if (event.note === targetNote) {
              filteredStream.push(event);
            }
          }
        }
      }
    }

    return { stream: filteredStream };
  },
  compileConfig: (uiConfig) => ({
    // Return values for Virtual Inputs
    channel: uiConfig.channel ?? 1,
    note: uiConfig.note ?? 60
  }),
});

registerNode(midiFilterNode);
