import { defineNode, registerNode } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";

// strict type inference
export const midiIsTriggerNode = defineNode({
  id: "midi.istrigger",
  version: "1.0.0",
  displayName: "MIDI Is Trigger",
  metadata: {
    category: NodeCategory.Logic,
    keywords: ['midi', 'check', 'trigger', 'gate'],
    description: 'Outputs 1 if the stream contains any Note On event, 0 otherwise.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  outputs: {
    result: numberType
  },
  createState: () => ({}),
  execute: (inputs, config, context, state) => {
    const stream = (inputs.stream || []) as MidiEvent[];
    let hasNoteOn = 0;

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.type === 'note_on') {
          hasNoteOn = 1;
          break;
        }
      }
    }

    return { result: hasNoteOn };
  }
});

registerNode(midiIsTriggerNode);
