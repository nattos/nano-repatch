import { defineNode, registerNode } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { NumberType } from "../../structor/type-helpers";
import { MidiEvent } from "../../io/midi/types";

interface MidiStreamInput {
  stream: MidiEvent[];
}
interface MidiSelectInputs extends MidiStreamInput { }

// explicit 'any' to bypass constraint
export const midiSelectNode = defineNode<any, { count?: number, root?: number, skip?: number }, { count: typeof NumberType, root: typeof NumberType, skip: typeof NumberType }>({
  id: "midi.select",
  version: "1.0.0",
  displayName: "MIDI Select",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'select', 'router', 'switch', 'demux'],
    description: 'Routes MIDI events to different ports based on note pitch.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  config: {
    count: { ...numberType, defaultValue: 4 },
    root: { ...numberType, defaultValue: 60 },
    skip: { ...numberType, defaultValue: 1 }
  },
  outputs: {},
  dynamicOutputType: midiStreamType,
  isRealtime: () => true,
  computeForwardPorts: (inputTypes, uiConfig, context) => {
    const count = (uiConfig.count as number) || 4;
    const outputs: any = {};

    for (let i = 0; i < count; i++) {
      outputs[i.toString()] = { ...midiStreamType, hint: 'midi-stream', description: `Offset ${i}` };
    }
    outputs['rem'] = { ...midiStreamType, hint: 'midi-stream', description: 'Remainder' };

    return {
      inputs: { kind: 'record', fields: { stream: midiStreamType } },
      outputs: { kind: 'record', fields: outputs }
    };
  },
  shouldRecompileOnConfigChange: (uiConfig) => {
    return true;
  },
  execute: (rawInputs: any, config, context) => {
    const inputs = rawInputs as MidiSelectInputs;
    const stream = inputs.stream || [];
    const count = config.count || 4;
    const root = config.root || 60;
    const skip = config.skip || 1;

    const results: Record<string, MidiEvent[]> = {};
    for (let i = 0; i < count; i++) {
      results[i.toString()] = [];
    }
    results['rem'] = [];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.type === 'note_on' || event.type === 'note_off') {
          const diff = event.note - root;
          if (diff >= 0 && (diff % skip) === 0) {
            const index = diff / skip;
            if (index >= 0 && index < count) {
              results[index.toString()].push(event);
              continue;
            }
          }
          results['rem'].push(event);
        } else {
          // Ignore non-note events
        }
      }
    }

    return { ...results };
  },
  compileConfig: (uiConfig) => ({
    count: uiConfig.count ?? 4,
    root: uiConfig.root ?? 60,
    skip: uiConfig.skip ?? 1
  }),
  ui: {
    inspector: {
      fields: [
        { type: 'number', label: 'Output Count', path: 'count', min: 1, max: 128, step: 1, default: 4 },
        { type: 'number', label: 'Root Note', path: 'root', min: 0, max: 127, step: 1, default: 60 },
        { type: 'number', label: 'Skip (Semitones)', path: 'skip', min: 1, max: 24, step: 1, default: 1 }
      ]
    }
  }
});

registerNode(midiSelectNode);
