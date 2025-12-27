
import { defineType, StringType, NumberType, AnyType } from "../../structor/type-helpers";
import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import {
  numberType,
  booleanType,
  anyType,
  midiStreamType,
  stepStructorType,
  sequenceStructorType,
  noteStructorType,
  noteEventStructorType
} from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";
import { SeededRandom } from "./utils";
import { Step } from "./envelope-generator"; // Keep using local Step for now until full migration
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
// Types moved to std-types.ts

export const manySequencesType = defineType({
  kind: "array",
  size: "dynamic", // Technically Array<Sequence>
  element: sequenceStructorType
});

export const layerOutputStructorType = defineType({ kind: "atomic", type: "number" });

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
// RhythmicGenerator
export const rhythmicGenerator = defineNode<any, { targetNote?: number }, { targetNote: typeof NumberType }>({
  id: "nicepattern.rhythmic_generator",
  version: "1.0.0",
  displayName: "Rhythmic Generator",
  metadata: {
    category: 'NicePattern',
    keywords: ['rhythm', 'generator', 'sequence', 'euclidean'],
    description: 'Generates a rhythmic sequence based on density.'
  },
  config: { targetNote: numberType },
  inputs: { density: { ...numberType, defaultValue: 0.5 } },
  outputs: { seq_out: sequenceStructorType },
  ui: { inspector: { fields: RhythmicFields } },
  execute: (inputs, config, context) => {
    const targetNote = config.targetNote || 60;
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
    targetNote: uiConfig.targetNote ?? 60
  }),
});

// ChaosGenerator
// ChaosGenerator
export const chaosGenerator = defineNode<any, { minNote?: number, maxNote?: number, seed?: number }, { minNote: typeof NumberType, maxNote: typeof NumberType, seed: typeof NumberType }>({
  id: "nicepattern.chaos_generator",
  version: "1.0.0",
  displayName: "Chaos Generator",
  metadata: {
    category: 'NicePattern',
    keywords: ['chaos', 'random', 'generator', 'sequence', 'stochastic'],
    description: 'Generates a random sequence of notes.'
  },
  config: { minNote: numberType, maxNote: numberType, seed: numberType },
  inputs: { density: { ...numberType, defaultValue: 0.5 } },
  outputs: { seq_out: sequenceStructorType },
  ui: { inspector: { fields: ChaosFields } },
  execute: (inputs, config, context) => {
    const { minNote, maxNote, seed } = config;
    const density = inputs.density ?? 0.5;
    const rng = new SeededRandom(seed ?? 12345); // Default seed if not provided

    const sequence: Step[] = [];
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      if (rng.next() < density) {
        const note = rng.nextRange(minNote || 60, maxNote || 60);
        sequence.push({ noteIndex: note, velocity: rng.next() * 0.5 + 0.5, hold: false });
      } else {
        sequence.push({ noteIndex: null, velocity: 0, hold: false });
      }
    }
    return { seq_out: sequence };
  },
  compileConfig: (uiConfig) => ({
    minNote: uiConfig.minNote ?? 60,
    maxNote: uiConfig.maxNote ?? 60,
    seed: uiConfig.seed ?? 12345,
  }),
});

// Pattern Node moved to seq.tomidi in seq/nodes.ts
// export const pattern = ... removed


// ...

// --- Layer Nodes ---

// --- Layer Nodes ---

interface LayerState {
  layer: AbstractLayer;
  lastActive: boolean;
  activeVelocity: number;
  activeNote: number | null;
}

export function createLayerNode(
  id: string,
  displayName: string,
  LayerClass: new (config: LayerConfig) => AbstractLayer
) {
  return defineNode<any, {}, {}, any, LayerState>({
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
      midi_in: { type: midiStreamType, description: "Input MIDI stream", allowMultiConnection: true },
      prev_layer: { type: layerOutputStructorType, description: "Previous layer output" }
    },
    outputs: { out: layerOutputStructorType },
    autoBroadcast: {
      midi_in: { combine: { reduce: 'flatten' } }
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
      const stream = (inputs.midi_in || []).flat() as unknown as MidiEvent[];
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
    compileConfig: (uiConfig) => ({}),
  });
}

export const gateLayer = createLayerNode("nicepattern.gate_layer", "Gate Layer", GateLayer);
export const expLayer = createLayerNode("nicepattern.exp_layer", "Exponential Layer", ExponentialLayer);
export const pwmLayer = createLayerNode("nicepattern.pwm_layer", "PWM Layer", PWMLayer);
export const noiseLayer = createLayerNode("nicepattern.noise_layer", "Noise Layer", NoiseLayer);

// ToneSynthLayer is special as it takes audio context
// ToneSynthLayer is special as it takes audio context

interface ToneSynthState {
  layer: ToneSynthLayer;
  lastActive: boolean;
  lastActiveNote: number | null;
  activeVelocity: number;
  contextId: string;
}

export const toneSynthLayer = defineNode<any, {}, {}, any, ToneSynthState>({
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
    midi_in: { type: midiStreamType, description: "Input MIDI stream", allowMultiConnection: true },
    prev_layer: { type: layerOutputStructorType, description: "Previous layer output" }
  },
  outputs: { out: layerOutputStructorType },
  autoBroadcast: {
    midi_in: { combine: { reduce: 'flatten' } }
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
    // Ensure layer exists (resilience against state corruption or bad init)
    if (!state.layer) {
      state.layer = new ToneSynthLayer({});
    }

    if (audioContext && state.contextId !== audioContext.contextId) {
      state.layer = new ToneSynthLayer({});
      state.contextId = audioContext.contextId;
    }

    const activeLayer = state.layer;
    const stream = (inputs.midi_in || []).flat() as unknown as MidiEvent[];
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
  compileConfig: (uiConfig) => ({}),
});

// Register Nodes
registerNode(rhythmicGenerator);
registerNode(chaosGenerator);
// registerNode(pattern);
registerNode(gateLayer);
registerNode(expLayer);
registerNode(pwmLayer);
registerNode(noiseLayer);
registerNode(toneSynthLayer);
registerNode(orthomod);
registerNode(tone4);
registerNode(magneto);
