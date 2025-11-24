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
import { parseFloatOr } from "../../utils/utils";

// --- Real-time State Management ---

// HACK: This is a global state cache for node instances.
// A proper solution would involve the executor providing a unique instance ID.
const nodeStateCache = new Map<string, any>();


// --- Type Definitions ---

const numberType: AtomicType = { kind: "atomic", type: "number" };
const booleanType: AtomicType = { kind: "atomic", type: "boolean" };

const stepStructorType: RecordType = {
  kind: "record",
  fields: {
    noteIndex: { kind: "atomic", type: "any" }, // Can be number | null
    velocity: numberType,
    hold: { kind: "atomic", type: "boolean" },
  },
  untagged: [],
};

export const sequenceStructorType: ArrayType = {
  kind: "array",
  element: stepStructorType,
};

export const layerOutputStructorType: AtomicType = { kind: "atomic", type: "number" };

const noteStructorType: RecordType = {
  kind: "record",
  fields: {
    note: numberType,
    velocity: numberType,
  },
  untagged: [],
};

const noteEventStructorType: RecordType = {
  kind: "record",
  fields: {
    onNote: { ...noteStructorType, optional: true },
    offNote: { ...noteStructorType, optional: true },
    hold: booleanType,
  },
  untagged: [],
};

const SEQUENCE_LENGTH = 16;

// --- Node Implementations ---

// RhythmicGenerator
const rhythmicGeneratorPrimitive: PrimitiveNodeDefinition = {
  id: "nicepattern:rhythmic_generator",
  kind: "primitive",
  configType: {
    kind: "record",
    fields: { targetNote: numberType, density: numberType },
    untagged: [],
  },
  computeOutputTypes: (inputType, configType, context) => ({
    kind: "record",
    fields: { seq_out: sequenceStructorType },
    untagged: [],
  }),
  execute: (input, config, context) => {
    const { targetNote, density } = (config as StructorRecord).fields as {
      targetNote: number;
      density: number;
    };
    const sequence: Step[] = [];
    const numEvents = Math.round(density * SEQUENCE_LENGTH);
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      if ((i * numEvents) % SEQUENCE_LENGTH < numEvents) {
        sequence.push({ noteIndex: targetNote, velocity: 1.0, hold: false });
      } else {
        sequence.push({ noteIndex: null, velocity: 0, hold: false });
      }
    }
    return { fields: { seq_out: sequence }, untagged: [] };
  },
};

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
const chaosGeneratorPrimitive: PrimitiveNodeDefinition = {
    id: "nicepattern:chaos_generator",
    kind: "primitive",
    configType: {
      kind: "record",
      fields: { minNote: numberType, maxNote: numberType, density: numberType },
      untagged: [],
    },
    computeOutputTypes: (inputType, configType, context) => ({
      kind: "record",
      fields: { seq_out: sequenceStructorType },
      untagged: [],
    }),
    execute: (input, config, context) => {
      const { minNote, maxNote, density } = (config as StructorRecord).fields as {
        minNote: number;
        maxNote: number;
        density: number;
      };
      const sequence: Step[] = [];
      for (let i = 0; i < SEQUENCE_LENGTH; i++) {
        if (Math.random() < density) {
            const note = Math.floor(Math.random() * (maxNote - minNote + 1)) + minNote;
            sequence.push({ noteIndex: note, velocity: Math.random() * 0.5 + 0.5, hold: false });
        } else {
            sequence.push({ noteIndex: null, velocity: 0, hold: false });
        }
      }
      return { fields: { seq_out: sequence }, untagged: [] };
    },
  };

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
const patternPrimitive: PrimitiveNodeDefinition = {
  id: "nicepattern:pattern",
  kind: "primitive",
  isRealtime: () => true,
  computeOutputTypes: (inputType, configType, context) => {
    return { kind: "record", fields: { event_out: noteEventStructorType }, untagged: [] };
  },
  execute: (input, config, context) => {
    const key = `pattern-${JSON.stringify(config)}`;
    if (!nodeStateCache.has(key)) {
      nodeStateCache.set(key, { lastStepIndex: -1 });
    }
    const state = nodeStateCache.get(key);

    const inputSequences = context.broadcast({
        outputs: { 'seqs': { fromFields: ['seq_in'], fromUntagged: true, combine: 'collect' } },
        reshape: 'none'
    }, input).fields.seqs as Sequence[];

    const combinedSequence: Step[] = [];
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      let step: Step = { noteIndex: null, velocity: 0, hold: false };
      for (const seq of (inputSequences || [])) {
        if (seq?.[i]?.noteIndex !== null) {
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
        if (lastStep.noteIndex !== null) {
          noteEvent.offNote = { fields: { note: lastStep.noteIndex, velocity: 0 }, untagged: [] };
        }
        if (currentStep.noteIndex !== null) {
          noteEvent.onNote = { fields: { note: currentStep.noteIndex, velocity: currentStep.velocity }, untagged: [] };
        }
      }
      state.lastStepIndex = currentStepIndex;
    }

    return { fields: { event_out: { fields: noteEvent, untagged: [] } }, untagged: [] };
  },
};

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
  const primitive: PrimitiveNodeDefinition = {
    id,
    kind: "primitive",
    isRealtime: () => true,
    configType: {
      kind: "record",
      fields: { targetNote: numberType },
      untagged: [],
    },
    computeOutputTypes: () => ({
      kind: "record",
      fields: { 'out': layerOutputStructorType },
      untagged: [layerOutputStructorType],
    }),
    execute: (input, config, context) => {
        const key = `${id}-${JSON.stringify(config)}`;
        if (!nodeStateCache.has(key)) {
            const targetNote = (config as StructorRecord).fields.targetNote as number;
            nodeStateCache.set(key, {
                layer: new LayerClass({ targetNoteIndex: targetNote }),
                lastActive: false,
            });
        }
        const state = nodeStateCache.get(key);
        const layer = state.layer as AbstractLayer;

        const noteEvent = input.fields['event_in'] as StructorRecord;
        const onNote = noteEvent?.fields.onNote as StructorRecord;
        const offNote = noteEvent?.fields.offNote as StructorRecord;
        const targetNote = (config as StructorRecord).fields.targetNote as number;

        let noteIndexForUpdate: number | null = state.lastActive ? targetNote : null;
        let velocityForUpdate = 0;

        if (onNote) {
          noteIndexForUpdate = targetNote;
          velocityForUpdate = onNote.fields.velocity as number;
          state.lastActive = true;
        } else if (offNote) {
          noteIndexForUpdate = null;
          state.lastActive = false;
        }

        const syntheticStep: Step = {
            noteIndex: noteIndexForUpdate,
            velocity: velocityForUpdate,
            hold: (noteEvent?.fields.hold as boolean) ?? false,
        };

        layer.update(syntheticStep, context.clock.dt);
        const result = layer.getValue();

      return { fields: { 'out': result }, untagged: [result] };
    },
  };

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
const toneSynthPrimitive: PrimitiveNodeDefinition = {
    id: "nicepattern:tone_synth_layer",
    kind: "primitive",
    isRealtime: () => true,
    configType: {
      kind: "record",
      fields: { targetNote: numberType },
      untagged: [],
    },
    computeOutputTypes: () => ({
      kind: "record",
      fields: { 'out': layerOutputStructorType },
      untagged: [layerOutputStructorType],
    }),
    execute: (input, config, context) => {
      const key = `nicepattern:tone_synth_layer-${JSON.stringify(config)}`;
      if (!nodeStateCache.has(key)) {
        const targetNote = (config as StructorRecord).fields.targetNote as number;
        // This is a placeholder for where we'd get a real audio context
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        nodeStateCache.set(key, {
            layer: new ToneSynthLayer({}, audioContext, 440),
            lastActive: false,
        });
      }
      const state = nodeStateCache.get(key);
      const layer = state.layer as AbstractLayer;

      const noteEvent = input.fields['event_in'] as StructorRecord;
      const onNote = noteEvent?.fields.onNote as StructorRecord;
      const offNote = noteEvent?.fields.offNote as StructorRecord;

      let noteIndexForUpdate: number | null = (state.lastActive ? state.lastActiveNote : null) ?? null;
      let velocityForUpdate = 0;

      let isEvent = false;
      if (onNote) {
        isEvent = true;
        noteIndexForUpdate = onNote.fields.note as number;
        velocityForUpdate = onNote.fields.velocity as number;
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
          hold: (noteEvent?.fields.hold as boolean) ?? false,
      };

      layer.update(syntheticStep, context.clock.dt);
      const result = layer.getValue();

      return { fields: { 'out': result }, untagged: [result] };
    },
  };

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