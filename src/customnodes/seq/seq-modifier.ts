import { defineNode, registerNode } from "../../structor/node-helpers";
import {
  sequenceStructorType,
  numberType,
} from "../../structor/std-types";
import { StringType } from "../../structor/type-helpers";
import { StructorType } from "../../structor/structor";
import { Step } from "./types";

interface SeqCropInputs {
  seq_in: Step[];
  trigger: any[]; // Ignored, just signature match
  duration: number;
  start?: number;
  end?: number; // For start-end mode
  length?: number; // For start-length mode
}

interface SeqFillInputs {
  count?: number;
  start?: number;
  end?: number;
  length?: number;
}

interface SeqCropUIConfig {
  mode?: string;
  values?: Record<string, any>;
}

interface SeqFillUIConfig {
  mode?: string;
  count?: number;
  values?: Record<string, any>;
}

export const crop = defineNode({
  id: "seq.crop",
  version: "1.0.0",
  displayName: "Crop Sequence",
  metadata: {
    category: 'Sequence',
    keywords: ['modifier', 'crop', 'slice'],
    description: 'Mutes steps outside the specified range.'
  },
  config: {
    mode: { kind: 'atomic', type: 'string', defaultValue: 'start-end' }
  },
  autoBroadcast: {
    seq_in: { combine: { reduce: 'first' } }
  },
  inputs: {
    seq_in: { type: sequenceStructorType, description: "Input sequence" },
    start: { type: numberType, defaultValue: 0 },
    end: { type: numberType, defaultValue: 1, optional: true },
    length: { type: numberType, defaultValue: 1, optional: true }
  },
  outputs: { seq_out: sequenceStructorType },
  ui: {
    inspector: {
      fields: [
        {
          type: 'tab-bar', label: 'Mode', path: 'mode',
          options: [{ label: 'Start / End', value: 'start-end' }, { label: 'Start / Length', value: 'start-length' }]
        }
      ]
    }
  },
  computeForwardPorts: (inputTypes, uiConfig) => {
    // Access mode from top-level config (merged by GraphExecutor)
    const mode = uiConfig.mode || 'start-end';

    const fields: Record<string, StructorType> = {
      seq_in: sequenceStructorType,
      start: { ...numberType, defaultValue: 0 }
    };
    if (mode === 'start-length') {
      fields['length'] = { ...numberType, defaultValue: 1 };
    } else {
      fields['end'] = { ...numberType, defaultValue: 1 };
    }
    return { inputs: { kind: 'record', fields }, outputs: { kind: 'record', fields: { seq_out: sequenceStructorType } } };
  },

  shouldRecompileOnConfigChange: () => true,
  compileConfig: (uiConfig: SeqCropUIConfig) => ({
    // Return Flat Data Structure
    mode: uiConfig.mode || 'start-end'
  }),

  execute: (inputs, config) => {
    // Inputs are strictly typed
    const seq = inputs.seq_in || [];

    // Correctly inferred config
    const mode = config.mode || 'start-end';

    // Deep clone is safer
    const outSeq = seq.map(s => ({ ...s }));

    const start = inputs.start ?? 0;
    let end = 1;

    if (mode === 'start-length') {
      const length = inputs.length ?? 1;
      end = start + length;
    } else {
      end = inputs.end ?? 1;
    }
    if (end < start) end = start;

    const len = outSeq.length;
    for (let i = 0; i < len; i++) {
      const pos = i / len;
      // Inclusive range? pos >= start && pos < end
      if (pos < start || pos >= end) {
        outSeq[i].noteIndex = null;
        outSeq[i].velocity = 0;
        outSeq[i].hold = false;
      }
    }

    return { seq_out: outSeq };
  }
});

export const fill = defineNode({
  id: "seq.fill",
  version: "1.0.0",
  displayName: "Fill Sequence",
  metadata: {
    category: 'Sequence',
    keywords: ['generator', 'fill', 'range'],
    description: 'Generates a sequence where steps inside the specified range are ON.'
  },
  config: {
    mode: { kind: 'atomic', type: 'string', defaultValue: 'start-length' },
    count: { ...numberType, defaultValue: 16 }
  },
  inputs: {
    start: { type: numberType, defaultValue: 0 },
    end: { type: numberType, defaultValue: 1, optional: true },
    length: { type: numberType, defaultValue: 0.5, optional: true }
  },
  outputs: { seq_out: sequenceStructorType },
  ui: {
    inspector: {
      fields: [
        {
          type: 'tab-bar', label: 'Mode', path: 'mode',
          options: [{ label: 'Start / End', value: 'start-end' }, { label: 'Start / Length', value: 'start-length' }],
          default: 'start-length'
        },
        { type: 'number', label: 'Step Count', path: 'count', min: 1, max: 128, step: 1, default: 16 }
      ]
    }
  },
  computeForwardPorts: (inputTypes, uiConfig) => {
    const mode = uiConfig.mode || 'start-length';
    const fields: Record<string, StructorType> = {
      start: { ...numberType, defaultValue: 0 }
    };
    if (mode === 'start-length') {
      fields['length'] = { ...numberType, defaultValue: 0.5 };
    } else {
      fields['end'] = { ...numberType, defaultValue: 1 };
    }
    return { inputs: { kind: 'record', fields }, outputs: { kind: 'record', fields: { seq_out: sequenceStructorType } } };
  },

  shouldRecompileOnConfigChange: () => true,
  compileConfig: (uiConfig: SeqFillUIConfig) => ({
    mode: uiConfig.mode || 'start-length',
    count: uiConfig.count ?? 16
  }),

  execute: (inputs, config) => {
    // Inputs are strictly typed
    const count = config.count ?? 16;
    const mode = config.mode || 'start-length';

    // Initialize sequence
    const outSeq: Step[] = [];
    for (let i = 0; i < count; i++) {
      outSeq.push({ noteIndex: null, velocity: 0, hold: false });
    }

    const startVal = inputs.start ?? 0;

    if (mode === 'start-length') {
      const lengthVal = inputs.length ?? 0.5;
      // Integer-based logic: Fixed number of ON steps
      const numOn = Math.round(lengthVal * count);
      const startIndex = Math.floor(startVal * count);

      for (let i = 0; i < numOn; i++) {
        // No wrapping: Truncate at end
        const idx = startIndex + i;

        if (idx >= 0 && idx < count) {
          outSeq[idx] = { noteIndex: 60, velocity: 1, hold: false };
        }
      }
    } else {
      // Start-End Mode: Standard Range Logic (Inclusive-Exclusive)
      const endVal = inputs.end ?? 1;
      // Handle wrapping for start > end ? Or simple clamp/min?
      // Basic implementation: Linear range.
      let actualStart = startVal;
      let actualEnd = endVal;
      if (actualEnd < actualStart) actualEnd = actualStart; // Clamp

      for (let i = 0; i < count; i++) {
        const pos = i / count;
        if (pos >= actualStart && pos < actualEnd) {
          outSeq[i] = { noteIndex: 60, velocity: 1, hold: false };
        }
      }
    }

    return { seq_out: outSeq };
  }
});

registerNode(crop);
registerNode(fill);
