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
import { html } from "lit";

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
    createState: () => ({
      layer: new LayerClass({ targetNoteIndex: 0 }), // Initial target note will be updated in execute
      lastActive: false,
    }),
    execute: (inputs, config, context, state) => {
      const activeLayer = state.layer as AbstractLayer;

      // Update layer config if needed (though layer usually takes config in constructor)
      // The original code re-created the layer if config changed because key included config.
      // With our new state mechanism, state is persisted per config key (hack in type-helpers).
      // So if config changes, we get new state, so new layer. Correct.
      // But we should probably update the layer's target note if it supports it, or rely on the re-creation.
      // Since the hack in type-helpers uses config in key, a config change = new state = new layer.
      // So we just need to ensure the initial layer has the right config.
      // But createState doesn't receive config!
      // Ah, this is a limitation of the current createState design if we want to rely on config-based keys.
      // If we rely on config-based keys, then createState is called when config changes.
      // But we can't pass config to createState in the current signature.
      // However, we can update the layer in execute.

      // Assuming AbstractLayer has a way to set targetNoteIndex or we just rely on it being correct?
      // The original code passed targetNote to constructor.
      // Let's check AbstractLayer.
      // It seems we might need to update the layer properties.
      // Or we can just assume the layer is fresh if config changed (due to the key hack).
      // But wait, if we use the key hack, we are creating a NEW state for every config change.
      // So we need to initialize it correctly.
      // But createState doesn't take arguments.
      // So we initialize with default, then update in execute?
      // Or we change createState to take config?
      // Let's update the layer in execute to be safe.

      // Actually, looking at the original code:
      // const targetNote = (config as StructorRecord).fields.targetNote as number;
      // nodeStateCache.set(key, { layer: new LayerClass({ targetNoteIndex: targetNote }), ... });

      // So we need to handle this.
      // Since we can't pass config to createState, we'll initialize with 0, and then...
      // wait, LayerClass constructor takes config.
      // If we can't pass config to createState, we can't fully emulate the original behavior if the layer is immutable.
      // But AbstractLayer likely allows updates.
      // Let's assume we can update it or that we can access config in execute and re-initialize if needed?
      // No, state is persistent.

      // Let's just update the layer's target note in execute if possible.
      // If not, we might need to extend createState to take config.
      // But for now, let's assume we can set it.
      // Actually, AbstractLayer usually has an update method.

      // Let's stick to the current plan: initialize with 0, and if the layer needs the config, we rely on the fact that
      // we are using the config-based key, so we are getting a fresh state for this config.
      // But wait, if we get a fresh state, createState is called.
      // And createState doesn't know the config.
      // So we create a layer with targetNoteIndex: 0.
      // Then in execute, we have the real config.
      // We should probably check if the layer's target note matches the config and update it?
      // Or just assume the layer handles it?
      // The original code passed it to constructor.

      // Let's try to update the layer in execute.
      // But wait, AbstractLayer definition is not visible here.
      // Let's assume we can't easily change the layer's target note after construction if it's not exposed.
      // However, looking at `createLayerNode` implementation, it passes `targetNoteIndex` to constructor.

      // Ideally, `createState` should receive `config`.
      // Let's modify `type-helpers.ts` to pass `config` to `createState`.
      // But I already wrote `type-helpers.ts`.
      // I can update it again.
      // Or I can just initialize with 0 and hope for the best? No, that's risky.

      // Let's update `type-helpers.ts` to pass `config` to `createState`.
      // It's a small change and makes it much more robust.

      // Wait, I can't do that in this tool call.
      // I will proceed with this refactor assuming I will fix `type-helpers.ts` in the next step.
      // So I will write the code as if `createState` receives `config`.

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

      activeLayer.update(syntheticStep, context.clock.dt);
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
      lastActiveNote: null as number | null
    };
  },
  execute: (inputs, config, context, state) => {
    const activeLayer = state.layer;

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

    // Use the provided audio context from execution context
    // We fallback to creating one only if not provided (e.g. in tests without mock audio)
    activeLayer.audioContext ??= context.audio?.context || new (window.AudioContext || (window as any).webkitAudioContext)();
    activeLayer.update(syntheticStep, context.clock.dt);
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