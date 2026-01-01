import { defineNode, registerNode } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { AnyType } from "../../structor/type-helpers";
import { MidiEvent } from "../../io/midi/types";

interface MidiOnChangeInputs {
  value: any;
}
interface MidiOnChangeConfig {
  rootNote?: number;
}
interface MidiOnChangeState {
  lastValue: any;
}

// using strict inference
export const midiOnChangeNode = defineNode({
  id: "midi.onchange",
  version: "1.0.0",
  displayName: "MIDI On Change",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'trigger', 'change', 'delta'],
    description: 'Triggers a note when input value changes.'
  },
  inputs: {
    value: { type: AnyType, description: "Input Value" }
  },
  config: {
    rootNote: { type: numberType, defaultValue: 60 }
  },
  outputs: {
    stream: midiStreamType
  },
  ui: {
    inspector: {
      fields: [
        { type: 'number', label: 'Root Note', path: 'rootNote', min: 0, max: 127, step: 1, default: 60 }
      ]
    }
  },
  isRealtime: () => true,
  createState: (): MidiOnChangeState => ({ lastValue: undefined }),
  execute: (inputs, config, context, state) => {
    // inputs.value is inferred as any (AnyType)
    const value = inputs.value;
    // console.log('MidiOnChange Exec:', { value, lastValue: state.lastValue });
    const root = config.rootNote ?? 60;
    const stream: MidiEvent[] = [];

    let changed = false;
    if (typeof value === 'number' && typeof state.lastValue === 'number') {
      if (Math.abs(value - state.lastValue) > 1e-5) {
        changed = true;
      }
    } else {
      if (value !== state.lastValue) {
        changed = true;
      }
    }

    if (changed) {
      // Trigger Note On -> Note Off pair immediately
      stream.push({ type: 'note_on', note: root, velocity: 127, channel: 1, time: 0, deviceId: 'onchange' });
      stream.push({ type: 'note_off', note: root, velocity: 0, channel: 1, time: 0, deviceId: 'onchange' });
      state.lastValue = value;
    } else if (state.lastValue === undefined && value !== undefined) {
      // Initialize state silently
      state.lastValue = value;
    }

    return { stream };
  },
  compileConfig: (uiConfig: MidiOnChangeConfig) => ({
    rootNote: uiConfig.rootNote ?? 60
  })
});

registerNode(midiOnChangeNode);
