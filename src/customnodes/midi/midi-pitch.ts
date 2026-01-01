import { defineNode, registerNode } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";

interface MidiStreamInput {
  stream: MidiEvent[];
}
interface MidiPitchInputs extends MidiStreamInput {
  pitch?: number;
}

// midi.pitch: uses inputs, config is empty
// explicit 'any' to bypass constraint
export const midiPitchNode = defineNode<any, { pitch?: number }, {}>({
  id: "midi.pitch",
  version: "1.0.0",
  displayName: "MIDI Pitch",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'pitch', 'transpose', 'shift'],
    description: 'Transposes MIDI Note events by a specified amount.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true },
    pitch: { type: numberType, description: 'Pitch shift amount (semitones)', defaultValue: 0, range: [-24, 24] }
  },
  config: {},
  outputs: {
    stream: midiStreamType
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  execute: (rawInputs: any, config) => {
    const inputs = rawInputs as MidiPitchInputs;
    // Inputs drove by generic Logic
    const shift = (inputs.pitch ?? 0) as number;
    const stream = inputs.stream || [];

    if (!stream || !Array.isArray(stream)) return { stream: [] };

    const processedStream: MidiEvent[] = stream.map(event => {
      if (event.type === 'note_on' || event.type === 'note_off') {
        const newNote = Math.max(0, Math.min(127, Math.floor(event.note + shift)));
        return { ...event, note: newNote };
      }
      return event;
    });

    return { stream: processedStream };
  },
  compileConfig: (uiConfig) => ({
    pitch: uiConfig.pitch ?? 0
  }),
});

registerNode(midiPitchNode);
