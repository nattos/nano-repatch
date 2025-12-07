import {
  ExecutionContext,
  StructorRecord,
} from "../../structor/structor";
import {
  NodeType,
} from "../../structor/repository";
import { defineType, typedBroadcast } from "../../structor/type-helpers";
import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { numberType, booleanType, anyType, midiStreamType, midiEventType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";
import { SeededRandom } from "./utils";
import { Step } from "./envelope-generator";
import {
  GateLayer,
  ExponentialLayer,
  PWMLayer,
  NoiseLayer,
  ToneSynthLayer,
} from "./layers";

export {
  GateLayer,
  ExponentialLayer,
  PWMLayer,
  NoiseLayer,
  ToneSynthLayer,
};
import { orthomod } from "./orthomod";
import { tone4 } from "./tone4";
import { magneto } from "./magneto";
import { AbstractLayer, LayerConfig } from "./abstract-layer";

// --- Real-time State Management ---
// State is now handled by the ExecutionContext and definePrimitiveNode helper.

// --- Type Definitions ---

const stepStructorType = defineType({
  kind: "record",
  fields: {
    noteIndex: anyType, // Can be number | null
    velocity: numberType,
    hold: booleanType,
  },
  untagged: [],
});

export const sequenceStructorType = defineType({
  kind: "array",
  size: "dynamic",
  element: stepStructorType,
  hint: 'step-sequence'
});

export const layerOutputStructorType = defineType({ kind: "atomic", type: "number" });

const noteStructorType = defineType({
  kind: "record",
  fields: {
    note: numberType,
    velocity: numberType,
  },
  untagged: [],
});

const noteEventStructorType = defineType({
  kind: "record",
  fields: {
    onNote: { ...noteStructorType, optional: true },
    offNote: { ...noteStructorType, optional: true },
    hold: booleanType,
  },
  untagged: [],
});

const SEQUENCE_LENGTH = 16;

// --- UI Field Definitions ---

const RhythmicFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Target Note', path: 'targetNote' }
];

const ChaosFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Min Note', path: 'minNote' },
  { type: 'number', label: 'Max Note', path: 'maxNote' },
  { type: 'number', label: 'Seed', path: 'seed' }
];



// --- Node Implementations ---

// RhythmicGenerator
export const rhythmicGenerator = defineNode({
  id: "nicepattern.rhythmic_generator",
  version: "1.0.0",
  displayName: "Rhythmic Generator",
  metadata: {
    category: 'NicePattern',
    keywords: ['rhythm', 'generator', 'sequence', 'euclidean'],
    description: 'Generates a rhythmic sequence based on density.'
  },
  config: { targetNote: numberType },
  inputs: { density: numberType },
  outputs: { seq_out: sequenceStructorType },
  ui: { inspector: { fields: RhythmicFields } },
  execute: (inputs, config, context) => {
    const targetNote = config.targetNote;
    const density = inputs.density ?? 0.5;

    const sequence: Step[] = [];
    const numEvents = Math.round(density * SEQUENCE_LENGTH);
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      if ((i * numEvents) % SEQUENCE_LENGTH < numEvents) {
        sequence.push({ noteIndex: targetNote, velocity: 1.0, hold: false });
      } else {
        sequence.push({ noteIndex: null, velocity: 0, hold: false });
      }
    }
    return { seq_out: sequence };
  },
  compileConfig: (uiConfig) => ({
    fields: {
      targetNote: uiConfig?.targetNote ?? 60,
    },
    untagged: [],
  }),
});

// ChaosGenerator
export const chaosGenerator = defineNode({
  id: "nicepattern.chaos_generator",
  version: "1.0.0",
  displayName: "Chaos Generator",
  metadata: {
    category: 'NicePattern',
    keywords: ['chaos', 'random', 'generator', 'sequence', 'stochastic'],
    description: 'Generates a random sequence of notes.'
  },
  config: { minNote: numberType, maxNote: numberType, seed: numberType },
  inputs: { density: numberType },
  outputs: { seq_out: sequenceStructorType },
  ui: { inspector: { fields: ChaosFields } },
  execute: (inputs, config, context) => {
    const { minNote, maxNote, seed } = config;
    const density = inputs.density ?? 0.5;

    const rng = new SeededRandom(seed ?? 12345); // Default seed if not provided

    const sequence: Step[] = [];
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      if (rng.next() < density) {
        const note = rng.nextRange(minNote, maxNote);
        sequence.push({ noteIndex: note, velocity: rng.next() * 0.5 + 0.5, hold: false });
      } else {
        sequence.push({ noteIndex: null, velocity: 0, hold: false });
      }
    }
    return { seq_out: sequence };
  },
  compileConfig: (uiConfig) => ({
    fields: {
      minNote: uiConfig?.minNote ?? 60,
      maxNote: uiConfig?.maxNote ?? 60,
      seed: uiConfig?.seed ?? 12345,
    },
    untagged: [],
  }),
});

// Pattern Node
export const pattern = defineNode({
  id: "nicepattern.pattern",
  version: "1.0.0",
  displayName: "Pattern",
  metadata: {
    category: 'NicePattern',
    keywords: ['pattern', 'sequencer', 'combiner', 'event'],
    description: 'Combines multiple sequences into a MIDI stream.'
  },
  config: {},
  inputs: {
    seq_in: { type: sequenceStructorType, description: "Input sequence(s)", redirect: 'untagged' }
  },
  outputs: { midi_out: midiStreamType },
  autoBroadcast: {
    seq_in: { combine: 'collect', fromUntagged: true }
  },
  isRealtime: () => true,
  createState: () => ({
    sequenceStates: new Map<number, {
      lastStepIndex: number,
      lastNoteIndex: number | null,
      lastHold: boolean,
      activeNotes: Map<number, number>
    }>()
  }),
  execute: (inputs, config, context, state) => {
    const seqs = inputs.seq_in as Step[][]; // Array of sequences
    const stream: MidiEvent[] = [];
    const stepsPerBeat = 4;
    const absoluteStep = Math.floor(context.clock.beat * stepsPerBeat);
    const currentStepIndex = ((absoluteStep % SEQUENCE_LENGTH) + SEQUENCE_LENGTH) % SEQUENCE_LENGTH;

    // Process all sequences (both current inputs and previously active ones)
    const seqIndices = new Set<number>();
    if (Array.isArray(seqs)) {
        seqs.forEach((_, i) => seqIndices.add(i));
    }
    state.sequenceStates.forEach((_, i) => seqIndices.add(i));

    for (const seqIndex of seqIndices) {
        const seq = (Array.isArray(seqs) ? seqs[seqIndex] : undefined);

        // Initialize state for this sequence if missing
        if (!state.sequenceStates.has(seqIndex)) {
            state.sequenceStates.set(seqIndex, {
              lastStepIndex: -1,
              lastNoteIndex: null,
              lastHold: false,
              activeNotes: new Map<number, number>()
            });
        }
        const seqState = state.sequenceStates.get(seqIndex)! as {
          lastStepIndex: number,
          lastNoteIndex: number | null,
          lastHold: boolean,
          activeNotes: Map<number, number>
        };

        // If seq is gone and no active note, cleanup
        if (!seq && seqState.lastNoteIndex === null) {
            state.sequenceStates.delete(seqIndex);
            continue;
        }

        const currentStep = (seq && seq[currentStepIndex]) ? seq[currentStepIndex] : { noteIndex: null, velocity: 0, hold: false };

        // Check if we need to update:
        // 1. Moved to a new step
        // 2. Input sequence disappeared (!seq)
        // 3. Note at current step CHANGED (e.g. pattern modulation or cable disconnect)
        // 4. Force update if unknown state
        if (currentStepIndex !== seqState.lastStepIndex || !seq || currentStep.noteIndex !== seqState.lastNoteIndex) {

            // Logic: Compare currentStep against STORED state
            const lastNoteIndex = seqState.lastNoteIndex;
            const lastHold = seqState.lastHold;

            const isNoteActive = currentStep.noteIndex !== null && currentStep.noteIndex !== undefined;
            const isSameNote = isNoteActive && currentStep.noteIndex === lastNoteIndex;

            // Release conditions:
            // 1. We had a note (lastNoteIndex != null)
            // 2. AND (New note is different OR (Same note but NOT held))
            // Note: If input disappeared (!seq), currentStep is null-step, so isSameNote is false.
            const shouldRelease = (lastNoteIndex !== null) && (!isSameNote || !lastHold);

            // Trigger conditions:
            // 1. We have a new note (isNoteActive)
            // 2. AND (Only trigger if state changed to active, avoids retriggering same note same step if update logic runs due to other change?)
            // Actually, if update logic runs, it means something changed.
            // But if we just checked 'lastNoteIndex', we are good.
            const shouldTrigger = isNoteActive && (!isSameNote || !lastHold);

            if (shouldRelease && lastNoteIndex !== null) {
                stream.push({
                    type: 'note_off',
                    note: lastNoteIndex,
                    velocity: 0,
                    channel: 1,
                    deviceId: 'pattern',
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
                    deviceId: 'pattern',
                    time: 0
                });
                seqState.activeNotes.set(currentStep.noteIndex, currentStep.velocity);
                seqState.lastNoteIndex = currentStep.noteIndex;
                seqState.lastHold = currentStep.hold;
            } else if (isSameNote && lastHold) {
                // Determine if we are just continuing (holding)
                // We don't need to change state, but we should carry over hold status
                seqState.lastHold = currentStep.hold;
            }

            seqState.lastStepIndex = currentStepIndex;
        }
    }

    return { midi_out: stream };
  },
});

// ...

// --- Layer Nodes ---

// --- Layer Nodes ---

export function createLayerNode(
  id: string,
  displayName: string,
  LayerClass: new (config: LayerConfig) => AbstractLayer
) {
  return defineNode({
    id,
    version: "1.0.0",
    displayName,
    metadata: {
      category: 'NicePattern',
      keywords: ['layer', 'effect', 'modifier'],
      description: `Layer node: ${displayName}`
    },
    config: {}, // Removed targetNote
    inputs: {
      midi_in: { type: midiStreamType, description: "Input MIDI stream" },
      prev_layer: { type: layerOutputStructorType, description: "Previous layer output" }
    },
    outputs: { out: layerOutputStructorType },
    autoBroadcast: {
      midi_in: { combine: { reduce: 'first' } }
    },
    ui: { inspector: { fields: [] } }, // Removed LayerFields (targetNote)
    isRealtime: () => true,
    createState: (config, context) => {
      return {
        layer: new LayerClass({}),
        lastActive: false,
        activeVelocity: 0,
        activeNote: null as number | null
      };
    },
    execute: (inputs, config, context, state) => {
      const activeLayer = state.layer as AbstractLayer;
      const stream = (inputs.midi_in || []) as unknown as MidiEvent[];
      // Removed targetNote

      // Process MIDI stream
      for (const event of stream) {
        if (event.type === 'note_on') {
          // Trigger on ANY note, track it as active
          state.lastActive = true;
          state.activeVelocity = event.velocity;
          state.activeNote = event.note;
        } else if (event.type === 'note_off') {
          // Only release if the Off event matches our current active note
          if (state.activeNote === event.note) {
            state.lastActive = false;
            state.activeNote = null;
          }
        }
      }

      const syntheticStep: Step = {
        noteIndex: state.lastActive ? (state.activeNote ?? 60) : null,
        velocity: state.activeVelocity,
        hold: false, // We don't easily track hold from stream without more state
      };

      // We assume isNewStep is true if we processed any relevant events?
      // Or we rely on the layer's internal logic.
      // The original code passed 'isNewStep' if the event object changed reference.
      // Here, we should probably pass true if we received a Note On.
      const hasNoteOn = stream.some((e: MidiEvent) => e.type === 'note_on');

      activeLayer.update(syntheticStep, context.clock.dt, hasNoteOn);
      const result = activeLayer.getValue();

      return { out: result };
    },
    compileConfig: (uiConfig) => ({
      fields: {},
      untagged: [],
    }),
  });
}

export const gateLayer = createLayerNode("nicepattern.gate_layer", "Gate Layer", GateLayer);
export const expLayer = createLayerNode("nicepattern.exp_layer", "Exponential Layer", ExponentialLayer);
export const pwmLayer = createLayerNode("nicepattern.pwm_layer", "PWM Layer", PWMLayer);
export const noiseLayer = createLayerNode("nicepattern.noise_layer", "Noise Layer", NoiseLayer);

// ToneSynthLayer is special as it takes audio context
export const toneSynthLayer = defineNode({
  id: "nicepattern.tone_synth_layer",
  version: "1.0.0",
  displayName: "Tone Synth Layer",
  metadata: {
    category: 'NicePattern',
    keywords: ['synth', 'audio', 'sound', 'tone'],
    description: 'Simple synthesizer layer using Tone.js.'
  },
  config: {}, // Removed targetNote
  inputs: {
    midi_in: { type: midiStreamType, description: "Input MIDI stream" },
    prev_layer: { type: layerOutputStructorType, description: "Previous layer output" }
  },
  outputs: { out: layerOutputStructorType },
  autoBroadcast: {
    midi_in: { combine: { reduce: 'first' } }
  },
  ui: { inspector: { fields: [] } }, // Removed LayerFields
  isRealtime: () => true,
  createState: (config, context) => {
    return {
      layer: new ToneSynthLayer({}),
      lastActive: false,
      lastActiveNote: null as number | null,
      activeVelocity: 0,
      contextId: ''
    };
  },
  execute: (inputs, config, context, state) => {
    // Check for Audio Context Reset/Invalidation
    const audioContext = context.audio?.context;
    if (audioContext && state.contextId !== audioContext.contextId) {
         state.layer = new ToneSynthLayer({});
         state.contextId = audioContext.contextId;
    }

    const activeLayer = state.layer;
    const stream = (inputs.midi_in || []) as unknown as MidiEvent[];
    // Removed targetNote

    let hasNoteOn = false;

    // Process MIDI stream
    for (const event of stream) {
      if (event.type === 'note_on') {
        // Trigger on ANY note
        state.lastActive = true;
        state.lastActiveNote = event.note;
        state.activeVelocity = event.velocity;
        hasNoteOn = true;
      } else if (event.type === 'note_off') {
        // Release only if matching
        if (state.lastActiveNote === event.note) {
          state.lastActive = false;
          state.lastActiveNote = null;
        }
      }
    }

    const syntheticStep: Step = {
      noteIndex: state.lastActive ? state.lastActiveNote : null,
      velocity: state.activeVelocity,
      hold: false,
    };

    // Use the provided audio context from execution context
    if (!activeLayer.audioContext) {
      if (context.audio?.context) {
        activeLayer.audioContext = context.audio.context;
      } else if (typeof window !== 'undefined') {
        activeLayer.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    }

    activeLayer.update(syntheticStep, context.clock.dt, hasNoteOn);
    const result = activeLayer.getValue();

    return { out: result };
  },
  compileConfig: (uiConfig) => ({
    fields: {},
    untagged: [],
  }),
});

// Register Nodes
registerNode(rhythmicGenerator);
registerNode(chaosGenerator);
registerNode(pattern);
registerNode(gateLayer);
registerNode(expLayer);
registerNode(pwmLayer);
registerNode(noiseLayer);
registerNode(toneSynthLayer);
registerNode(orthomod);
registerNode(tone4);
registerNode(magneto);
