import {
  PrimitiveNodeDefinition,
  RecordType,
  Structor,
  StructorType,
  AnalysisContext,
  ExecutionContext,
  StructorRecord,
  ArrayType,
  AtomicType,
} from "../../structor/structor";
import {
  defaultNodeRepository,
  NodeType,
  PortHint,
  InspectorChangeHandler,
  GraphNodeRenderHandlers,
} from "../../structor/repository";
import { defineType, definePrimitiveNode, typedBroadcast, NumberType, AnyType } from "../../structor/type-helpers";
import { numberType, booleanType, anyType, midiStreamType } from "../../structor/std-types";
import { Step, Sequence } from "./envelope-generator";
import {
  GateLayer,
  ExponentialLayer,
  PWMLayer,
  NoiseLayer,
  ToneSynthLayer,
} from "./layers";
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

// --- Node Implementations ---

// RhythmicGenerator
export const rhythmicGeneratorPrimitive = definePrimitiveNode({
  id: "nicepattern:rhythmic_generator",
  metadata: {
    category: 'NicePattern',
    keywords: ['rhythm', 'generator', 'sequence', 'euclidean'],
    description: 'Generates a rhythmic sequence based on density.'
  },
  config: { targetNote: numberType, density: numberType },
  inputs: {},
  outputs: { seq_out: sequenceStructorType },
  execute: (inputs, config, context) => {
    const { targetNote, density } = config;
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
});

defaultNodeRepository.register({
  id: "nicepattern:rhythmic_generator",
  version: "1.0.0",
  displayName: "Rhythmic Generator",
  definition: rhythmicGeneratorPrimitive,
  inputs: [],
  outputs: [{ name: "seq_out", type: sequenceStructorType, description: "Generated sequence" }],
  compileConfig: (uiConfig) => ({
    fields: {
      targetNote: uiConfig?.targetNote ?? 60,
      density: uiConfig?.density ?? 0.5,
    },
    untagged: [],
  }),
});

// ChaosGenerator
export const chaosGeneratorPrimitive = definePrimitiveNode({
  id: "nicepattern:chaos_generator",
  metadata: {
    category: 'NicePattern',
    keywords: ['chaos', 'random', 'generator', 'sequence', 'stochastic'],
    description: 'Generates a random sequence of notes.'
  },
  config: { minNote: numberType, maxNote: numberType, density: numberType },
  inputs: {},
  outputs: { seq_out: sequenceStructorType },
  execute: (inputs, config, context) => {
    const { minNote, maxNote, density } = config;
    const sequence: Step[] = [];
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      if (Math.random() < density) {
        const note = Math.floor(Math.random() * (maxNote - minNote + 1)) + minNote;
        sequence.push({ noteIndex: note, velocity: Math.random() * 0.5 + 0.5, hold: false });
      } else {
        sequence.push({ noteIndex: null, velocity: 0, hold: false });
      }
    }
    return { seq_out: sequence };
  },
});

defaultNodeRepository.register({
  id: "nicepattern:chaos_generator",
  version: "1.0.0",
  displayName: "Chaos Generator",
  definition: chaosGeneratorPrimitive,
  inputs: [],
  outputs: [{ name: "seq_out", type: sequenceStructorType, description: "Generated sequence" }],
  compileConfig: (uiConfig) => ({
    fields: {
      minNote: uiConfig?.minNote ?? 60,
      maxNote: uiConfig?.maxNote ?? 72,
      density: uiConfig?.density ?? 0.5,
    },
    untagged: [],
  }),
});

// Pattern Node
export const patternPrimitive = definePrimitiveNode({
  id: "nicepattern:pattern",
  metadata: {
    category: 'NicePattern',
    keywords: ['pattern', 'sequencer', 'combiner', 'event'],
    description: 'Combines multiple sequences into a MIDI stream.'
  },
  config: {},
  inputs: {}, // We handle inputs manually via typedBroadcast
  outputs: { midi_out: midiStreamType },
  isRealtime: () => true,
  createState: () => ({ lastStepIndex: -1, activeNotes: new Map<number, number>() }), // activeNotes: note -> velocity
  execute: (inputs, config, context, state) => {
    const rawInputs = inputs as unknown as StructorRecord;

    const { seqs } = typedBroadcast(context, {
      seqs: {
        source: 'seq_in',
        fromUntagged: true,
        combine: 'collect',
        type: sequenceStructorType
      }
    }, rawInputs);

    const combinedSequence: Step[] = [];
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      let step: Step = { noteIndex: null, velocity: 0, hold: false };
      for (const seq of (seqs || [])) {
        if (seq?.[i]?.noteIndex !== null && seq?.[i]?.noteIndex !== undefined) {
          step.noteIndex = seq[i].noteIndex;
          step.velocity = seq[i].velocity;
          step.hold = seq[i].hold;
        }
      }
      combinedSequence.push(step);
    }

    const stepsPerBeat = 4;
    const absoluteStep = Math.floor(context.clock.beat * stepsPerBeat);
    const currentStepIndex = ((absoluteStep % SEQUENCE_LENGTH) + SEQUENCE_LENGTH) % SEQUENCE_LENGTH;

    const stream: any[] = [];

    if (currentStepIndex !== state.lastStepIndex) {
      const lastStep = combinedSequence[state.lastStepIndex] ?? { noteIndex: null };
      const currentStep = combinedSequence[currentStepIndex];

      // Determine if we need to trigger a note
      // 1. Note changed (different pitch or went from null to note)
      // 2. Same note, but previous step didn't hold (Retrigger)
      const isNoteActive = currentStep.noteIndex !== null && currentStep.noteIndex !== undefined;
      const isSameNote = isNoteActive && currentStep.noteIndex === lastStep.noteIndex;
      const shouldTrigger = isNoteActive && (!isSameNote || !lastStep.hold);

      const shouldRelease = (lastStep.noteIndex !== null && lastStep.noteIndex !== undefined) &&
        (currentStep.noteIndex !== lastStep.noteIndex || (isSameNote && !lastStep.hold));

      if (shouldRelease) {
        stream.push({
          status: 0x80, // Note Off
          data1: lastStep.noteIndex!,
          data2: 0,
          time: 0
        });
        state.activeNotes.delete(lastStep.noteIndex!);
      }

      if (shouldTrigger) {
        stream.push({
          status: 0x90, // Note On
          data1: currentStep.noteIndex!,
          data2: Math.floor(currentStep.velocity * 127),
          time: 0
        });
        state.activeNotes.set(currentStep.noteIndex!, currentStep.velocity);
      }

      state.lastStepIndex = currentStepIndex;
    }

    return { midi_out: stream };
  },
});

defaultNodeRepository.register({
  id: "nicepattern:pattern",
  version: "1.0.0",
  displayName: "Pattern",
  definition: patternPrimitive,
  inputs: [{ name: "seq_in", type: sequenceStructorType, description: "Input sequence(s)", redirect: 'untagged' }],
  outputs: [{ name: "midi_out", type: midiStreamType, description: "Real-time MIDI stream" }],
});

// --- Layer Nodes ---

// --- Layer Nodes ---

function createLayerNode(
  id: string,
  displayName: string,
  LayerClass: new (config: LayerConfig) => AbstractLayer
): NodeType {
  const primitive = definePrimitiveNode({
    id,
    metadata: {
      category: 'NicePattern',
      keywords: ['layer', 'effect', 'modifier'],
      description: `Layer node: ${displayName}`
    },
    config: { targetNote: numberType },
    inputs: { midi_in: midiStreamType, prev_layer: layerOutputStructorType },
    outputs: { out: layerOutputStructorType },
    autoBroadcast: {
      midi_in: { combine: { reduce: 'first' } }
    },
    isRealtime: () => true,
    createState: (config, context) => {
      return {
        layer: new LayerClass({ targetNoteIndex: config.targetNote }),
        lastActive: false,
        activeVelocity: 0
      };
    },
    execute: (inputs, config, context, state) => {
      const activeLayer = state.layer as AbstractLayer;
      const stream = inputs.midi_in || [];
      const targetNote = config.targetNote;

      // Process MIDI stream
      for (const event of stream) {
        const status = event.status & 0xF0;
        if (status === 0x90 && event.data2 > 0) { // Note On
          if (event.data1 === targetNote) {
            state.lastActive = true;
            state.activeVelocity = event.data2 / 127;
          }
        } else if (status === 0x80 || (status === 0x90 && event.data2 === 0)) { // Note Off
          if (event.data1 === targetNote) {
            state.lastActive = false;
          }
        }
      }

      const syntheticStep: Step = {
        noteIndex: state.lastActive ? targetNote : null,
        velocity: state.activeVelocity,
        hold: false, // We don't easily track hold from stream without more state
      };

      // We assume isNewStep is true if we processed any relevant events?
      // Or we rely on the layer's internal logic.
      // The original code passed 'isNewStep' if the event object changed reference.
      // Here, we should probably pass true if we received a Note On for our target.
      const hasNoteOn = stream.some((e: any) => (e.status & 0xF0) === 0x90 && e.data2 > 0 && e.data1 === targetNote);

      activeLayer.update(syntheticStep, context.clock.dt, hasNoteOn);
      const result = activeLayer.getValue();

      return { out: result };
    },
  });

  return {
    id,
    version: "1.0.0",
    displayName,
    definition: primitive,
    inputs: [
      { name: "midi_in", type: midiStreamType, description: "Input MIDI stream" },
      { name: "prev_layer", type: layerOutputStructorType, description: "Previous layer output" }
    ],
    outputs: [{ name: "out", type: layerOutputStructorType, description: "Layer output" }],
    compileConfig: (uiConfig) => ({
      fields: {
        targetNote: uiConfig?.targetNote ?? 60,
      },
      untagged: [],
    }),
  };
}

defaultNodeRepository.register(createLayerNode("nicepattern:gate_layer", "Gate Layer", GateLayer));
defaultNodeRepository.register(createLayerNode("nicepattern:exp_layer", "Exponential Layer", ExponentialLayer));
defaultNodeRepository.register(createLayerNode("nicepattern:pwm_layer", "PWM Layer", PWMLayer));
defaultNodeRepository.register(createLayerNode("nicepattern:noise_layer", "Noise Layer", NoiseLayer));

// ToneSynthLayer is special as it takes audio context
const toneSynthPrimitive = definePrimitiveNode({
  id: "nicepattern:tone_synth_layer",
  metadata: {
    category: 'NicePattern',
    keywords: ['synth', 'audio', 'sound', 'tone'],
    description: 'Simple synthesizer layer using Tone.js.'
  },
  config: { targetNote: numberType },
  inputs: { midi_in: midiStreamType, prev_layer: layerOutputStructorType },
  outputs: { out: layerOutputStructorType },
  autoBroadcast: {
    midi_in: { combine: { reduce: 'first' } }
  },
  isRealtime: () => true,
  createState: (config, context) => {
    return {
      layer: new ToneSynthLayer({}),
      lastActive: false,
      lastActiveNote: null as number | null,
      activeVelocity: 0
    };
  },
  execute: (inputs, config, context, state) => {
    const activeLayer = state.layer;
    const stream = inputs.midi_in || [];

    let hasNoteOn = false;

    // Process MIDI stream
    for (const event of stream) {
      const status = event.status & 0xF0;
      if (status === 0x90 && event.data2 > 0) { // Note On
        state.lastActive = true;
        state.lastActiveNote = event.data1;
        state.activeVelocity = event.data2 / 127;
        hasNoteOn = true;
      } else if (status === 0x80 || (status === 0x90 && event.data2 === 0)) { // Note Off
        if (event.data1 === state.lastActiveNote) {
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
});

defaultNodeRepository.register({
  id: "nicepattern:tone_synth_layer",
  version: "1.0.0",
  displayName: "Tone Synth Layer",
  definition: toneSynthPrimitive,
  inputs: [
    { name: "midi_in", type: midiStreamType, description: "Input MIDI stream" },
    { name: "prev_layer", type: layerOutputStructorType, description: "Previous layer output" }
  ],
  outputs: [{ name: "out", type: layerOutputStructorType, description: "Layer output" }],
  compileConfig: (uiConfig) => ({
    fields: {
      targetNote: uiConfig?.targetNote ?? 60,
    },
    untagged: [],
  }),
});