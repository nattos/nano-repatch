
import { defineNode, registerNode } from "../../structor/node-helpers";
import { StringType } from "../../structor/type-helpers";
import {
  midiStreamType,
  sequenceStructorType,
  numberType,
} from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";
import { Step } from "./types";

const SEQUENCE_LENGTH = 16;

import { AnyType } from "../../structor/type-helpers";

// ...

/**
 * seq.tomidi (formerly nicepattern.pattern)
 * Combines multiple sequences into a MIDI stream.
 */
interface SeqToMidiState {
  sequenceStates: Map<number, {
    lastStepIndex: number;
    lastNoteIndex: number | null;
    lastHold: boolean;
    activeNotes: Map<number, number>;
  }>;
}

interface SeqOneShotState {
  isPlaying: boolean;
  startTime: number;
  lastStepIndex: number;
  lastNoteIndex: number | null;
  lastHold: boolean;
  activeNotes: Map<number, number>;
}

interface SeqScanState {
  lastStepIndex: number;
  lastNoteIndex: number | null;
  lastHold: boolean;
  activeNotes: Map<number, number>;
}

export const tomidi = defineNode<any, {}, {}, any, SeqToMidiState>({
  id: "seq.tomidi",
  version: "1.0.0",
  displayName: "To MIDI",
  metadata: {
    category: 'Sequence',
    keywords: ['pattern', 'sequencer', 'combiner', 'event', 'midi'],
    description: 'Converts sequence(s) into a MIDI stream.'
  },
  config: {},
  inputs: {
    seq_in: {
      type: { kind: "array", size: "dynamic", element: sequenceStructorType },
      description: "Input sequence(s)",
      allowMultiConnection: true
    }
  },
  outputs: { midi_out: midiStreamType },
  isRealtime: () => true,
  createState: () => ({
    sequenceStates: new Map()
  }),
  execute: (inputs, config, context, state) => {
    // Inputs are Structors. unpack them.
    const seqInInput = inputs.seq_in as any;

    let seqs: any[] = [];
    if (seqInInput && typeof seqInInput === 'object') {
      if (Array.isArray(seqInInput)) {
        seqs = seqInInput;
      } else if (seqInInput.kind === 'array' && seqInInput.elements) {
        seqs = seqInInput.elements;
      }
    }

    const stream: MidiEvent[] = [];
    const stepsPerBeat = 4;
    const absoluteStep = Math.floor(context.clock.beat * stepsPerBeat);
    const currentStepIndex = ((absoluteStep % SEQUENCE_LENGTH) + SEQUENCE_LENGTH) % SEQUENCE_LENGTH;

    // Process all sequences (both current inputs and previously active ones)
    const seqIndices = new Set<number>();
    seqs.forEach((_, i) => seqIndices.add(i));
    state.sequenceStates.forEach((_, i) => seqIndices.add(i));

    for (const seqIndex of seqIndices) {
      const seqStructor = seqs[seqIndex];
      // Unwrap sequence array
      let seq: any[] | undefined;
      if (seqStructor) {
        if (Array.isArray(seqStructor)) seq = seqStructor;
        else if (seqStructor.kind === 'array') seq = seqStructor.elements;
        else seq = seqStructor; // Fallback or raw object
      }

      // Initialize state for this sequence if missing
      if (!state.sequenceStates.has(seqIndex)) {
        state.sequenceStates.set(seqIndex, {
          lastStepIndex: -1,
          lastNoteIndex: null,
          lastHold: false,
          activeNotes: new Map<number, number>()
        });
      }
      const seqState = state.sequenceStates.get(seqIndex)!;

      // If seq is gone and no active note, cleanup
      if (!seq && seqState.lastNoteIndex === null) {
        state.sequenceStates.delete(seqIndex);
        continue;
      }

      let currentStep: { noteIndex: number | null, velocity: number, hold: boolean } = { noteIndex: null, velocity: 0, hold: false };

      if (seq && seq[currentStepIndex]) {
        const rawStep = seq[currentStepIndex];
        if (rawStep.fields) {
          currentStep = {
            noteIndex: rawStep.fields.noteIndex,
            velocity: rawStep.fields.velocity ?? 0,
            hold: rawStep.fields.hold ?? false
          };
        } else {
          currentStep = rawStep;
        }
      }

      // Check if we need to update
      if (currentStepIndex !== seqState.lastStepIndex || !seq || currentStep.noteIndex !== seqState.lastNoteIndex) {

        const lastNoteIndex = seqState.lastNoteIndex;
        const lastHold = seqState.lastHold;

        const isNoteActive = currentStep.noteIndex !== null && currentStep.noteIndex !== undefined;
        const isSameNote = isNoteActive && currentStep.noteIndex === lastNoteIndex;

        const shouldRelease = (lastNoteIndex !== null) && (!isSameNote || !lastHold);
        const shouldTrigger = isNoteActive && (!isSameNote || !lastHold);

        if (shouldRelease && lastNoteIndex !== null) {
          stream.push({
            type: 'note_off',
            note: lastNoteIndex,
            velocity: 0,
            channel: 1,
            deviceId: 'tomidi',
            time: 0
          });
          seqState.activeNotes.delete(lastNoteIndex);
          seqState.lastNoteIndex = null;
          seqState.lastHold = false;
        }

        if (shouldTrigger && currentStep.noteIndex !== null) {
          stream.push({
            type: 'note_on',
            note: currentStep.noteIndex,
            velocity: currentStep.velocity,
            channel: 1,
            deviceId: 'tomidi',
            time: 0
          });
          seqState.activeNotes.set(currentStep.noteIndex, currentStep.velocity);
          seqState.lastNoteIndex = currentStep.noteIndex;
          seqState.lastHold = currentStep.hold;
        } else if (isSameNote && lastHold) {
          seqState.lastHold = currentStep.hold;
        }

        seqState.lastStepIndex = currentStepIndex;
      }
    }

    return { midi_out: stream };
  },
});

/**
 * seq.sequencer
 * Hero Node - Step Sequencer Source
 */
interface SeqSequencerUIConfig {
  values?: {
    sequence?: Step[];
  };
}

type SeqSequencerCompiledConfig = {
  sequence: typeof AnyType;
};

interface SequencerState {
  currentStepIndex: number;
}

export const sequencer = defineNode<any, SeqSequencerUIConfig, SeqSequencerCompiledConfig, any, SequencerState>({
  id: "seq.sequencer",
  version: "1.0.0",
  displayName: "Sequencer",
  metadata: {
    category: 'Sequence',
    keywords: ['sequencer', 'step', 'pattern'],
    description: '16-step sequencer.'
  },
  config: {
    sequence: {
      kind: 'array',
      size: 16,
      element: { kind: 'record', fields: { noteIndex: numberType, velocity: numberType, hold: { kind: 'atomic', type: 'boolean' } } }
    }
  },
  inputs: {},
  outputs: { seq_out: sequenceStructorType },
  ui: {
    // Body renderer registered in ui-registration.ts
  },

  compileConfig: (uiConfig) => {
    // Default sequence: 16 empty steps
    const defaultSeq = Array(16).fill({ noteIndex: null, velocity: 0, hold: false });
    return {
      sequence: uiConfig?.values?.sequence ?? defaultSeq
    };
  },

  createState: () => ({
    currentStepIndex: 0
  }),

  // Not realtime anymore, purely static configuration unless updated
  isRealtime: () => false,

  execute: (inputs, config, context, state) => {
    // We are NOT realtime, so we rely on invalidation/config updates.
    // However, GraphExecutor calls execute at least once during init loop if dirty.

    // config.sequence is the Array Record of current Pattern
    const defaultSeq = Array(16).fill({ noteIndex: null, velocity: 0, hold: false });
    const sequenceRaw = (config as any).sequence || defaultSeq;

    // GraphExecutor/definePrimitiveNode expects raw values. It performs the Structor marshalling.
    // If we return { fields: ... }, toStructor will look for properties on the fields wrapper and fail.
    // So we just return the raw sequence (or a mapped version if we needed to transform it).
    // The sequenceRaw from config is already in the correct shape { noteIndex, velocity, hold }.

    return {
      outputs: { seq_out: sequenceRaw },
      ui: {
        currentStepIndex: state.currentStepIndex
      }
    };
  }
});


// Register
registerNode(tomidi);
registerNode(sequencer);

// --- Players ---

export const oneshot = defineNode<any, {}, {}, any, SeqOneShotState>({
  id: "seq.oneshot",
  version: "1.0.0",
  displayName: "One Shot",
  metadata: {
    category: 'Sequence',
    keywords: ['player', 'trigger', 'oneshot', 'envelope'],
    description: 'Plays a sequence once upon trigger.'
  },
  config: {},
  inputs: {
    seq_in: { type: sequenceStructorType, description: "Input sequence" },
    trigger: { type: midiStreamType, description: "Trigger", allowMultiConnection: true },
    duration: { type: numberType, defaultValue: 4.0, description: "Duration (s)" }
  },
  outputs: { midi_out: midiStreamType },
  isRealtime: () => true,
  createState: () => ({
    isPlaying: false,
    startTime: 0,
    lastStepIndex: -1,
    lastNoteIndex: null,
    lastHold: false,
    activeNotes: new Map()
  }),
  execute: (inputs, config, context, state) => {
    // Process Trigger
    const triggerStream = (inputs.trigger || []).flat() as MidiEvent[];
    let triggered = false;
    for (const e of triggerStream) {
      if (e.type === 'note_on' && e.velocity > 0) {
        triggered = true;
        break;
      }
    }

    if (triggered) {
      state.isPlaying = true;
      state.startTime = context.time ?? 0;
    }

    const seqRaw = inputs.seq_in as any;
    // Unwrap sequence
    let seq: Step[] = [];
    if (seqRaw) {
      if (Array.isArray(seqRaw)) seq = seqRaw;
      else if (seqRaw.kind === 'array') seq = seqRaw.elements;
    }

    const stream: MidiEvent[] = [];

    if (!state.isPlaying || !seq || seq.length === 0) {
      if (state.lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: state.lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'oneshot' });
        state.lastNoteIndex = null;
        state.lastHold = false;
      }
      if (state.activeNotes.size > 0) {
        state.activeNotes.clear();
      }
      return { midi_out: stream };
    }

    const duration = Math.max(0.001, inputs.duration ?? 4.0);
    const elapsed = (context.time ?? 0) - state.startTime;
    const t = elapsed / duration;

    if (t >= 1.0) {
      state.isPlaying = false;
      if (state.lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: state.lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'oneshot' });
        state.lastNoteIndex = null;
        state.lastHold = false;
      }
      return { midi_out: stream };
    }

    const stepCount = seq.length;
    const currentStepIndex = Math.floor(t * stepCount);

    let currentStep: Step = { noteIndex: null, velocity: 0, hold: false };
    if (seq[currentStepIndex]) {
      const rawStep = seq[currentStepIndex] as any;
      if (rawStep.fields) {
        currentStep = {
          noteIndex: rawStep.fields.noteIndex,
          velocity: rawStep.fields.velocity ?? 0,
          hold: rawStep.fields.hold ?? false
        };
      } else {
        currentStep = rawStep;
      }
    }

    if (currentStepIndex !== state.lastStepIndex || currentStep.noteIndex !== state.lastNoteIndex) {
      const lastNoteIndex = state.lastNoteIndex;
      const lastHold = state.lastHold;
      const isNoteActive = currentStep.noteIndex !== null;
      const isSameNote = isNoteActive && currentStep.noteIndex === lastNoteIndex;

      const shouldRelease = (lastNoteIndex !== null) && (!isSameNote || !lastHold);
      const shouldTrigger = isNoteActive && (!isSameNote || !lastHold);

      if (shouldRelease && lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'oneshot' });
        state.activeNotes.delete(lastNoteIndex);
        state.lastNoteIndex = null;
        state.lastHold = false;
      }

      if (shouldTrigger && currentStep.noteIndex !== null) {
        stream.push({ type: 'note_on', note: currentStep.noteIndex, velocity: currentStep.velocity, channel: 1, time: 0, deviceId: 'oneshot' });
        state.activeNotes.set(currentStep.noteIndex, currentStep.velocity);
        state.lastNoteIndex = currentStep.noteIndex;
        state.lastHold = currentStep.hold;
      } else if (isSameNote && lastHold) {
        state.lastHold = currentStep.hold;
      }
      state.lastStepIndex = currentStepIndex;
    }

    return { midi_out: stream };
  }
});

export const scan = defineNode<any, {}, {}, any, SeqScanState>({
  id: "seq.scan",
  version: "1.0.0",
  displayName: "Scan Sequence",
  metadata: {
    category: 'Sequence',
    keywords: ['player', 'scan', 'scrub'],
    description: 'Plays a sequence by scanning through positions.'
  },
  config: {},
  inputs: {
    seq_in: { type: sequenceStructorType, description: "Input sequence" },
    pos: { type: numberType, defaultValue: 0, description: "Position (0-1)" }
  },
  outputs: { midi_out: midiStreamType },
  isRealtime: () => true,
  createState: () => ({
    lastStepIndex: -1,
    lastNoteIndex: null,
    lastHold: false,
    activeNotes: new Map()
  }),
  execute: (inputs, config, context, state) => {
    const seqRaw = inputs.seq_in as any;
    let seq: Step[] = [];
    if (seqRaw) {
      if (Array.isArray(seqRaw)) seq = seqRaw;
      else if (seqRaw.kind === 'array') seq = seqRaw.elements;
    }

    const pos = inputs.pos ?? 0;
    const stream: MidiEvent[] = [];

    if (!seq || seq.length === 0 || pos >= 1.0 || pos < 0) {
      if (state.lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: state.lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'scan' });
        state.lastNoteIndex = null;
        state.lastHold = false;
      }
      return { midi_out: stream };
    }

    const stepCount = seq.length;
    const currentStepIndex = Math.floor(pos * stepCount);

    let currentStep: Step = { noteIndex: null, velocity: 0, hold: false };
    if (seq[currentStepIndex]) {
      const rawStep = seq[currentStepIndex] as any;
      if (rawStep.fields) {
        currentStep = {
          noteIndex: rawStep.fields.noteIndex,
          velocity: rawStep.fields.velocity ?? 0,
          hold: rawStep.fields.hold ?? false
        };
      } else {
        currentStep = rawStep;
      }
    }

    if (currentStepIndex !== state.lastStepIndex || currentStep.noteIndex !== state.lastNoteIndex) {
      const lastNoteIndex = state.lastNoteIndex;
      const lastHold = state.lastHold;
      const isNoteActive = currentStep.noteIndex !== null;
      const isSameNote = isNoteActive && currentStep.noteIndex === lastNoteIndex;

      const shouldRelease = (lastNoteIndex !== null) && (!isSameNote || !lastHold);
      const shouldTrigger = isNoteActive && (!isSameNote || !lastHold);

      if (shouldRelease && lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'scan' });
        state.lastNoteIndex = null;
        state.lastHold = false;
      }

      if (shouldTrigger && currentStep.noteIndex !== null) {
        stream.push({ type: 'note_on', note: currentStep.noteIndex, velocity: currentStep.velocity, channel: 1, time: 0, deviceId: 'scan' });
        state.lastNoteIndex = currentStep.noteIndex;
        state.lastHold = currentStep.hold;
      } else if (isSameNote && lastHold) {
        state.lastHold = currentStep.hold;
      }
      state.lastStepIndex = currentStepIndex;
    }

    return { midi_out: stream };
  }
});

// --- Modifiers ---

interface SeqCropUIConfig {
  mode?: string;
  values?: Record<string, any>;
}

type SeqCropCompiledConfig = {
  mode: typeof StringType;
};

export const crop = defineNode<any, SeqCropUIConfig, SeqCropCompiledConfig>({
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

    const fields: any = {
      seq_in: sequenceStructorType,
      start: { type: numberType, defaultValue: 0 }
    };
    if (mode === 'start-length') {
      fields['length'] = { type: numberType, defaultValue: 1 };
    } else {
      fields['end'] = { type: numberType, defaultValue: 1 };
    }
    return { inputs: { kind: 'record', fields }, outputs: { kind: 'record', fields: { seq_out: sequenceStructorType } } };
  },

  shouldRecompileOnConfigChange: () => true,
  compileConfig: (uiConfig) => ({
    // Return Flat Data Structure
    mode: uiConfig.mode || 'start-end'
  }),

  execute: (inputs, config) => {
    const seqRaw = inputs.seq_in as any;
    if (!seqRaw) return { seq_out: [] };

    // Correctly inferred config
    const mode = config.mode || 'start-end';

    let seq: Step[] = [];
    if (Array.isArray(seqRaw)) seq = seqRaw;
    else if (seqRaw.kind === 'array') seq = seqRaw.elements;

    // Deep clone is safer
    const outSeq = seq.map(s => {
      const raw = s as any;
      let step: Step;
      if (raw.fields) step = { noteIndex: raw.fields.noteIndex, velocity: raw.fields.velocity, hold: raw.fields.hold };
      else step = { ...raw };
      return step;
    });

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

export const xor = defineNode<any, {}, {}>({
  id: "seq.xor",
  version: "1.0.0",
  displayName: "Sequence XOR",
  metadata: { category: 'Sequence', keywords: ['logic', 'xor', 'merge'], description: 'XORs multiple sequences.' },
  config: {},
  inputs: {
    inputs: {
      type: { kind: "array", size: "dynamic", element: sequenceStructorType },
      description: "Sequences",
      allowMultiConnection: true
    }
  },
  outputs: { seq_out: sequenceStructorType },
  execute: (inputs) => {
    const unwrapSeq = (s: any) => {
      if (!s) return [];
      if (Array.isArray(s)) return s;
      if (s.kind === 'array') return s.elements;
      return [];
    };

    // Collect all input sequences
    const inputCol = inputs.inputs as any;
    let seqs: any[] = [];
    if (inputCol) {
      if (Array.isArray(inputCol)) seqs = inputCol;
      else if (inputCol.kind === 'array') seqs = inputCol.elements ?? [];
    }

    if (seqs.length === 0) return { seq_out: [] };

    // Find max length
    let len = 0;
    const unwrappedSeqs = seqs.map(unwrapSeq);
    unwrappedSeqs.forEach(s => len = Math.max(len, s.length));

    const outSeq: Step[] = [];

    for (let i = 0; i < len; i++) {
      let active = false;
      let lastStep: Step | null = null;

      for (const seq of unwrappedSeqs) {
        if (i < seq.length) {
          const stepRaw = seq[i];
          const noteIndex = stepRaw.fields ? stepRaw.fields.noteIndex : stepRaw.noteIndex;
          if (noteIndex !== null && noteIndex !== undefined) {
            // Toggle active state for XOR
            active = !active;
            lastStep = stepRaw;
          }
        }
      }

      if (active && lastStep) {
        const s = lastStep as any;
        if (s.fields) outSeq.push({ noteIndex: s.fields.noteIndex, velocity: s.fields.velocity, hold: s.fields.hold });
        else outSeq.push({ ...s });
      } else {
        outSeq.push({ noteIndex: null, velocity: 0, hold: false });
      }
    }

    return { seq_out: outSeq };
  }
});

export const negate = defineNode<any, {}, {}>({
  id: "seq.negate",
  version: "1.0.0",
  displayName: "Sequence Negate",
  metadata: { category: 'Sequence', keywords: ['logic', 'not', 'invert'], description: 'Inverts sequence activity.' },
  config: {},
  inputs: {
    seq_in: { type: sequenceStructorType }
  },
  outputs: { seq_out: sequenceStructorType },
  execute: (inputs) => {
    const unwrapSeq = (s: any) => {
      if (!s) return [];
      if (Array.isArray(s)) return s;
      if (s.kind === 'array') return s.elements;
      return [];
    };
    const seq = unwrapSeq(inputs.seq_in);
    const outSeq = seq.map((s: any) => {
      let step: Step;
      if (s.fields) step = { noteIndex: s.fields.noteIndex, velocity: s.fields.velocity, hold: s.fields.hold };
      else step = { ...s };

      if (step.noteIndex !== null) {
        step.noteIndex = null;
        step.velocity = 0;
        step.hold = false;
      } else {
        step.noteIndex = 60;
        step.velocity = 1.0;
        step.hold = false;
      }
      return step;
    });
    return { seq_out: outSeq };
  }
});

registerNode(oneshot);
registerNode(scan);
registerNode(crop);
registerNode(xor);
registerNode(negate);
