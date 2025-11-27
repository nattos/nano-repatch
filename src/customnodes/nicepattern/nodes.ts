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
import { numberType, booleanType, anyType } from "../../structor/std-types";
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
      targetNote: uiConfig?.targetNote ?? 0,
      density: uiConfig?.density ?? 0.5,
    },
    untagged: [],
  }),
});

// ChaosGenerator
export const chaosGeneratorPrimitive = definePrimitiveNode({
  id: "nicepattern:chaos_generator",
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
      minNote: uiConfig?.minNote ?? 0,
      maxNote: uiConfig?.maxNote ?? 12,
      density: uiConfig?.density ?? 0.5,
    },
    untagged: [],
  }),
});

// Pattern Node
export const patternPrimitive = definePrimitiveNode({
  id: "nicepattern:pattern",
  config: {},
  inputs: {}, // We handle inputs manually via typedBroadcast
  outputs: { event_out: noteEventStructorType },
  isRealtime: () => true,
  createState: () => ({ lastStepIndex: -1 }),
  execute: (inputs, config, context, state) => {
    // Note: inputs here is empty because we didn't define inputs in options.
    // We access the raw inputs via context.broadcast (wrapped in typedBroadcast)
    // But wait, definePrimitiveNode passes 'inputs' which is InferRecord<TInputs>.
    // If TInputs is empty, inputs is empty.
    // But we need access to the raw inputs to pass to typedBroadcast!
    // definePrimitiveNode implementation passes 'processedInput' to execute.
    // If autoBroadcast is false (default), processedInput is rawInput (StructorRecord).
    // But the type signature says 'inputs' is InferRecord<...>.
    // So we need to cast 'inputs' to 'StructorRecord' to use it with typedBroadcast.

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
          step = seq[i];
          break;
        }
      }
      combinedSequence.push(step);
    }

    const stepsPerBeat = 4;
    const absoluteStep = Math.floor(context.clock.beat * stepsPerBeat);
    const currentStepIndex = ((absoluteStep % SEQUENCE_LENGTH) + SEQUENCE_LENGTH) % SEQUENCE_LENGTH;

    let noteEvent: { onNote?: any, offNote?: any, hold: boolean } = { hold: false };

    if (currentStepIndex !== state.lastStepIndex) {
      const lastStep = combinedSequence[state.lastStepIndex] ?? { noteIndex: null };
      const currentStep = combinedSequence[currentStepIndex];

      noteEvent.hold = currentStep.hold; // Set hold from currentStep

      // Determine if we need to trigger a note
      // 1. Note changed (different pitch or went from null to note)
      // 2. Same note, but previous step didn't hold (Retrigger)
      const isNoteActive = currentStep.noteIndex !== null && currentStep.noteIndex !== undefined;
      const isSameNote = isNoteActive && currentStep.noteIndex === lastStep.noteIndex;
      const shouldTrigger = isNoteActive && (!isSameNote || !lastStep.hold);

      if (currentStep.noteIndex !== lastStep.noteIndex) {
        if (lastStep.noteIndex !== null && lastStep.noteIndex !== undefined) {
          noteEvent.offNote = { note: lastStep.noteIndex, velocity: 0 };
        }
      }

      if (shouldTrigger) {
        noteEvent.onNote = { note: currentStep.noteIndex!, velocity: currentStep.velocity };
      }
      state.lastStepIndex = currentStepIndex;
    }

    return { event_out: noteEvent };
  },
});

defaultNodeRepository.register({
  id: "nicepattern:pattern",
  version: "1.0.0",
  displayName: "Pattern",
  definition: patternPrimitive,
  inputs: [{ name: "seq_in", type: sequenceStructorType, description: "Input sequence(s)", redirect: 'untagged' }],
  outputs: [{ name: "event_out", type: noteEventStructorType, description: "Real-time note events" }],
});

// --- Layer Nodes ---

function createLayerNode(
  id: string,
  displayName: string,
  LayerClass: new (config: LayerConfig) => AbstractLayer
): NodeType {
  const primitive = definePrimitiveNode({
    id,
    config: { targetNote: numberType },
    inputs: { event_in: noteEventStructorType, prev_layer: layerOutputStructorType },
    outputs: { out: layerOutputStructorType },
    autoBroadcast: true,
    isRealtime: () => true,
    createState: (config, context) => {
      return {
        layer: new LayerClass({ targetNoteIndex: config.targetNote }),
        lastActive: false,
        lastEvent: null as any
      };
    },
    execute: (inputs, config, context, state) => {
      const activeLayer = state.layer as AbstractLayer;
      const layer = state.layer as AbstractLayer;

      const noteEvent = inputs.event_in;
      const isNewStep = noteEvent !== state.lastEvent;
      state.lastEvent = noteEvent;

      const onNote = noteEvent?.onNote;
      const offNote = noteEvent?.offNote;
      const targetNote = config.targetNote;

      let noteIndexForUpdate: number | null = state.lastActive ? targetNote : null;
      let velocityForUpdate = 0;

      if (onNote) {
        noteIndexForUpdate = targetNote;
        velocityForUpdate = onNote.velocity;
        state.lastActive = true;
      } else if (offNote) {
        noteIndexForUpdate = null;
        state.lastActive = false;
      }

      const syntheticStep: Step = {
        noteIndex: noteIndexForUpdate,
        velocity: velocityForUpdate,
        hold: noteEvent?.hold ?? false,
      };

      activeLayer.update(syntheticStep, context.clock.dt, isNewStep);
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
      { name: "event_in", type: noteEventStructorType, description: "Input note event" },
      { name: "prev_layer", type: layerOutputStructorType, description: "Previous layer output" }
    ],
    outputs: [{ name: "out", type: layerOutputStructorType, description: "Layer output" }],
    compileConfig: (uiConfig) => ({
      fields: {
        targetNote: uiConfig?.targetNote ?? 0,
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
// ToneSynthLayer is special as it takes audio context
const toneSynthPrimitive = definePrimitiveNode({
  id: "nicepattern:tone_synth_layer",
  config: { targetNote: numberType },
  inputs: { event_in: noteEventStructorType, prev_layer: layerOutputStructorType },
  outputs: { out: layerOutputStructorType },
  autoBroadcast: true,
  isRealtime: () => true,
  createState: (config, context) => {
    return {
      layer: new ToneSynthLayer({}),
      lastActive: false,
      lastActiveNote: null as number | null,
      lastEvent: null as any
    };
  },
  execute: (inputs, config, context, state) => {
    const activeLayer = state.layer;

    const noteEvent = inputs.event_in;
    const isNewStep = noteEvent !== state.lastEvent;
    state.lastEvent = noteEvent;

    const onNote = noteEvent?.onNote;
    const offNote = noteEvent?.offNote;

    let noteIndexForUpdate: number | null = (state.lastActive ? state.lastActiveNote : null) ?? null;
    let velocityForUpdate = 0;

    let isEvent = false;
    if (onNote) {
      isEvent = true;
      noteIndexForUpdate = onNote.note;
      velocityForUpdate = onNote.velocity;
      state.lastActive = true;
      state.lastActiveNote = noteIndexForUpdate;
    } else if (offNote) {
      isEvent = true;
      noteIndexForUpdate = null;
      state.lastActive = false;
    }

    const syntheticStep: Step = {
      noteIndex: isEvent ? noteIndexForUpdate : null,
      velocity: velocityForUpdate,
      hold: noteEvent?.hold ?? false,
    };

    // Use the provided audio context from execution context
    // We fallback to creating one only if not provided (e.g. in tests without mock audio)
    // Safe for workers: check if window exists
    if (!activeLayer.audioContext) {
      if (context.audio?.context) {
        activeLayer.audioContext = context.audio.context;
      } else if (typeof window !== 'undefined') {
        activeLayer.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      // If in worker and no context provided, audioContext remains undefined/null.
      // ToneSynthLayer should handle this or it won't produce sound.
    }

    activeLayer.update(syntheticStep, context.clock.dt, isNewStep);
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
    { name: "event_in", type: noteEventStructorType, description: "Input note event" },
    { name: "prev_layer", type: layerOutputStructorType, description: "Previous layer output" }
  ],
  outputs: [{ name: "out", type: layerOutputStructorType, description: "Layer output" }],
  compileConfig: (uiConfig) => ({
    fields: {
      targetNote: uiConfig?.targetNote ?? 0,
    },
    untagged: [],
  }),
});