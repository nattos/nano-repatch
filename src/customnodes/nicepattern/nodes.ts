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
  NumberType,
  AnyType,
  PortHint,
  InspectorChangeHandler,
  GraphNodeRenderHandlers,
} from "../../structor/repository";
import { defineType, definePrimitiveNode, typedBroadcast } from "../../structor/type-helpers";
import { Step, Sequence } from "./envelope-generator";
import {
  GateLayer,
  ExponentialLayer,
  PWMLayer,
  NoiseLayer,
  ToneSynthLayer,
} from "./layers";
import { AbstractLayer, LayerConfig } from "./abstract-layer";
import { html } from "lit";

// --- Real-time State Management ---

// HACK: This is a global state cache for node instances.
// A proper solution would involve the executor providing a unique instance ID.
const nodeStateCache = new Map<string, any>();


// --- Type Definitions ---

const numberType = defineType({ kind: "atomic", type: "number" });
const booleanType = defineType({ kind: "atomic", type: "boolean" });

const stepStructorType = defineType({
  kind: "record",
  fields: {
    noteIndex: { kind: "atomic", type: "any" }, // Can be number | null
    velocity: numberType,
    hold: { kind: "atomic", type: "boolean" },
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
const rhythmicGeneratorPrimitive = definePrimitiveNode({
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
  renderInspector: (node, onchange) => html`
    <div class="field">
      <label>Target Note:</label>
      <input
        type="number"
        .value=${node.config?.targetNote ?? 0}
        @input=${(e: Event) =>
      onchange({ targetNote: parseInt((e.target as HTMLInputElement).value) })}
      />
    </div>
    <div class="field">
      <label>Density:</label>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        .value=${node.config?.density ?? 0.5}
        @input=${(e: Event) =>
      onchange({ density: parseFloat((e.target as HTMLInputElement).value) })}
      />
    </div>
  `,
});

// ChaosGenerator
const chaosGeneratorPrimitive = definePrimitiveNode({
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
  renderInspector: (node, onchange) => html`
      <div class="field">
        <label>Min Note:</label>
        <input
          type="number"
          .value=${node.config?.minNote ?? 0}
          @input=${(e: Event) =>
      onchange({ minNote: parseInt((e.target as HTMLInputElement).value) })}
        />
      </div>
      <div class="field">
        <label>Max Note:</label>
        <input
        type="number"
        .value=${node.config?.maxNote ?? 12}
        @input=${(e: Event) =>
      onchange({ maxNote: parseInt((e.target as HTMLInputElement).value) })}
        />
      </div>
      <div class="field">
        <label>Density:</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          .value=${node.config?.density ?? 0.5}
          @input=${(e: Event) =>
      onchange({ density: parseFloat((e.target as HTMLInputElement).value) })}
        />
      </div>
    `,
});

// Pattern Node
const patternPrimitive = definePrimitiveNode({
  id: "nicepattern:pattern",
  config: {},
  inputs: {}, // We handle inputs manually via typedBroadcast because of complex requirement
  outputs: { event_out: noteEventStructorType },
  isRealtime: () => true,
  execute: (inputs, config, context) => {
    // Note: inputs here is empty because we didn't define inputs in options.
    // We access the raw inputs via context.broadcast (wrapped in typedBroadcast)
    // But wait, definePrimitiveNode passes 'inputs' which is InferRecord<TInputs>.
    // If TInputs is empty, inputs is empty.
    // But we need access to the raw inputs to pass to typedBroadcast!
    // definePrimitiveNode implementation passes 'processedInput' to execute.
    // If autoBroadcast is false (default), processedInput is rawInput (StructorRecord).
    // But the type signature says 'inputs' is InferRecord<...>.
    // So we need to cast 'inputs' to 'StructorRecord' to use it with typedBroadcast.
    // This is a slight awkwardness in the API when mixing manual broadcast with definePrimitiveNode.

    const rawInputs = inputs as unknown as StructorRecord;

    // We use the config from the rawConfig (or just empty object since we defined no config fields)
    // But wait, the original code used `config` for cache key.
    // The original configType was empty? No, original configType was undefined in definition?
    // "configType: undefined" in original code?
    // No, original code:
    // const patternPrimitive: PrimitiveNodeDefinition = { ... configType: undefined (implicit) ... }
    // Actually computeOutputTypes signature: (inputType, configType, context)
    // execute signature: (input, config, context)
    // If configType is undefined, config is empty?
    // The original code used `JSON.stringify(config)` as key.

    const key = `pattern-${JSON.stringify(config)}`;
    if (!nodeStateCache.has(key)) {
      nodeStateCache.set(key, { lastStepIndex: -1 });
    }
    const state = nodeStateCache.get(key);

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

      if (currentStep.noteIndex !== lastStep.noteIndex) {
        if (lastStep.noteIndex !== null && lastStep.noteIndex !== undefined) {
          noteEvent.offNote = { note: lastStep.noteIndex, velocity: 0 };
        }
        if (currentStep.noteIndex !== null && currentStep.noteIndex !== undefined) {
          noteEvent.onNote = { note: currentStep.noteIndex, velocity: currentStep.velocity };
        }
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
  inputs: [{ name: "seq_in", type: sequenceStructorType, description: "Input sequence(s)" }],
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
    execute: (inputs, config, context) => {
      const key = `${id}-${JSON.stringify(config)}`;
      if (!nodeStateCache.has(key)) {
        const targetNote = config.targetNote;
        nodeStateCache.set(key, {
          layer: new LayerClass({ targetNoteIndex: targetNote }),
          lastActive: false,
        });
      }
      const state = nodeStateCache.get(key);
      const layer = state.layer as AbstractLayer;

      const noteEvent = inputs.event_in;
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

      layer.update(syntheticStep, context.clock.dt);
      const result = layer.getValue();

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
    renderInspector: (node, onchange) => html`
      <div class="field">
        <label>Target Note:</label>
        <input
          type="number"
          .value=${node.config?.targetNote ?? 0}
          @input=${(e: Event) =>
        onchange({ targetNote: parseInt((e.target as HTMLInputElement).value) })}
        />
      </div>
    `,
  };
}

defaultNodeRepository.register(createLayerNode("nicepattern:gate_layer", "Gate Layer", GateLayer));
defaultNodeRepository.register(createLayerNode("nicepattern:exp_layer", "Exponential Layer", ExponentialLayer));
defaultNodeRepository.register(createLayerNode("nicepattern:pwm_layer", "PWM Layer", PWMLayer));
defaultNodeRepository.register(createLayerNode("nicepattern:noise_layer", "Noise Layer", NoiseLayer));

// ToneSynthLayer is special as it takes audio context
const toneSynthPrimitive = definePrimitiveNode({
  id: "nicepattern:tone_synth_layer",
  config: { targetNote: numberType },
  inputs: { event_in: noteEventStructorType, prev_layer: layerOutputStructorType },
  outputs: { out: layerOutputStructorType },
  autoBroadcast: true,
  isRealtime: () => true,
  execute: (inputs, config, context) => {
    const key = `nicepattern:tone_synth_layer-${JSON.stringify(config)}`;
    if (!nodeStateCache.has(key)) {
      const targetNote = config.targetNote;
      // This is a placeholder for where we'd get a real audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      nodeStateCache.set(key, {
        layer: new ToneSynthLayer({}, audioContext, 440),
        lastActive: false,
      });
    }
    const state = nodeStateCache.get(key);
    const layer = state.layer as AbstractLayer;

    const noteEvent = inputs.event_in;
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

    layer.update(syntheticStep, context.clock.dt);
    const result = layer.getValue();

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
  renderInspector: (node, onchange) => html`
      <div class="field">
        <label>Target Note:</label>
        <input
          type="number"
          .value=${node.config?.targetNote ?? 0}
          @input=${(e: Event) =>
      onchange({ targetNote: parseInt((e.target as HTMLInputElement).value) })}
        />
      </div>
    `,
});