import { defineNode, registerNode } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";

interface MidiOnRangeInputs {
  value: number;
  start?: number;
  end?: number;
  [key: string]: number | undefined; // w1, w2...
}
interface MidiOnRangeConfig {
  rootNote?: number;
  zoneCount?: number;
  noteSkip?: number;
}
interface MidiOnRangeState {
  activeZoneIndex: number | null;
}

const weightInputs: Record<string, any> = {};
for (let i = 1; i <= 16; i++) {
  weightInputs[`w${i}`] = { type: numberType, defaultValue: 1.0, optional: true, description: `Weight ${i}` };
}

export const midiOnRangeNode = defineNode({
  id: "midi.onrange",
  version: "1.0.0",
  displayName: "MIDI On Range",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'trigger', 'range', 'zone'],
    description: 'Triggers notes based on value position in weighted zones.'
  },
  inputs: {
    value: { type: numberType, description: "Input Value" },
    start: { type: numberType, defaultValue: 0 },
    end: { type: numberType, defaultValue: 1 },
    ...weightInputs
  },
  config: {
    rootNote: { type: numberType, defaultValue: 60 },
    zoneCount: { type: numberType, defaultValue: 1 },
    noteSkip: { type: numberType, defaultValue: 1 }
  },
  outputs: {
    stream: midiStreamType
  },
  ui: {
    inspector: {
      fields: [
        { type: 'number', label: 'Root Note', path: 'rootNote', min: 0, max: 127, step: 1, default: 60 },
        { type: 'number', label: 'Zone Count', path: 'zoneCount', min: 1, max: 16, step: 1, default: 1 },
        { type: 'number', label: 'Note Skip', path: 'noteSkip', min: 1, max: 12, step: 1, default: 1 }
      ]
    }
  },
  isRealtime: () => true,
  createState: (): MidiOnRangeState => ({ activeZoneIndex: null }),

  computeForwardPorts: (inputTypes, uiConfig: MidiOnRangeConfig) => {
    const zoneCount = uiConfig.zoneCount ?? 1;
    const fields: any = {
      value: { type: numberType },
      start: { type: numberType, defaultValue: 0 },
      end: { type: numberType, defaultValue: 1 }
    };

    if (zoneCount > 1) {
      for (let i = 1; i <= zoneCount; i++) {
        fields[`w${i}`] = { type: numberType, defaultValue: 1.0, description: `Weight ${i}` };
      }
    }

    return {
      inputs: { kind: 'record', fields },
      outputs: { kind: 'record', fields: { stream: midiStreamType } }
    };
  },
  shouldRecompileOnConfigChange: () => true,

  execute: (inputs, config, context, state) => {
    // Inputs are strictly typed (including w1..w16 from weightInputs + any extras)
    // Dynamic inputs (w1..w16) are in `weightInputs` but `inputs` is inferred from `defineNode`'s `inputs`.
    // Since `weightInputs` is spread into `inputs`, inference sees them.
    // console.log('MidiOnRange Exec Inputs:', inputs);
    const value = inputs.value ?? 0;
    const start = inputs.start ?? 0;
    const end = inputs.end ?? 1;

    const root = config.rootNote ?? 60;
    const count = config.zoneCount ?? 1;
    const skip = config.noteSkip ?? 1;

    // Normalize range
    let actualStart = start;
    let actualEnd = end;
    if (actualEnd < actualStart) {
      actualEnd = start;
      actualStart = end;
    }

    const stream: MidiEvent[] = [];

    // Check if in range
    if (value >= actualStart && value <= actualEnd) {
      // Inside Range. Determine Zone.
      let targetZone = 0;

      if (count > 1) {
        const weights: number[] = [];
        let totalWeight = 0;
        for (let i = 1; i <= count; i++) {
          const rawW = inputs[`w${i}` as keyof MidiOnRangeInputs];
          let w: any = rawW;
          if (w && typeof w === 'object' && 'value' in w) {
            w = w.value;
          }
          w = w ?? 1.0;
          if (typeof w !== 'number') w = 1.0;

          weights.push(w);
          totalWeight += w;
        }

        if (totalWeight <= 0) {
          // Fallback
          targetZone = 0;
        } else {
          const rangeSpan = actualEnd - actualStart;
          // Normalize value to 0-totalWeight
          // value = start + (t * span)
          // t = (value - start) / span
          const t = (rangeSpan === 0) ? 0 : (value - actualStart) / rangeSpan;
          const weightPos = t * totalWeight;

          let currentW = 0;
          for (let i = 0; i < count; i++) {
            currentW += weights[i];
            if (weightPos <= currentW) {
              targetZone = i;
              break;
            }
          }
          // Clamp to last zone if floating point error pushes it slightly over
          if (targetZone >= count) targetZone = count - 1;
        }
      } else {
        targetZone = 0; // Single zone
      }

      // State Update Logic
      if (state.activeZoneIndex === null) {
        // Entered Range
        const note = root + (targetZone * skip);
        stream.push({ type: 'note_on', note, velocity: 127, channel: 1, time: 0, deviceId: 'onrange' });
        state.activeZoneIndex = targetZone;
      } else if (state.activeZoneIndex !== targetZone) {
        // Changed Zone
        const oldNote = root + (state.activeZoneIndex * skip);
        stream.push({ type: 'note_off', note: oldNote, velocity: 0, channel: 1, time: 0, deviceId: 'onrange' });

        const newNote = root + (targetZone * skip);
        stream.push({ type: 'note_on', note: newNote, velocity: 127, channel: 1, time: 0, deviceId: 'onrange' });
        state.activeZoneIndex = targetZone;
      }

    } else {
      // Outside Range
      if (state.activeZoneIndex !== null) {
        // Exited
        const oldNote = root + (state.activeZoneIndex * skip);
        stream.push({ type: 'note_off', note: oldNote, velocity: 0, channel: 1, time: 0, deviceId: 'onrange' });
        state.activeZoneIndex = null;
      }
    }

    return { stream };
  },
  compileConfig: (uiConfig: MidiOnRangeConfig) => ({
    rootNote: uiConfig.rootNote ?? 60,
    zoneCount: uiConfig.zoneCount ?? 1,
    noteSkip: uiConfig.noteSkip ?? 1
  })
});

registerNode(midiOnRangeNode);
