import { defineNode, registerNode } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";

interface MidiStreamInput {
  stream: MidiEvent[];
}
interface MidiMergeInputs extends MidiStreamInput { }

// strict type inference
export const midiMergeNode = defineNode({
  id: "midi.merge",
  version: "1.0.0",
  displayName: "MIDI Merge",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'merge', 'combine', 'mix'],
    description: 'Merges multiple MIDI streams into one using auto-broadcast.'
  },
  inputs: {
    stream: { type: midiStreamType, description: 'Input Streams', allowMultiConnection: true }
  },
  outputs: {
    stream: midiStreamType
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  config: {},
  execute: (inputs, config, context) => {
    return { stream: (inputs.stream || []) as MidiEvent[] };
  },
  compileConfig: () => ({})
});

registerNode(midiMergeNode);
