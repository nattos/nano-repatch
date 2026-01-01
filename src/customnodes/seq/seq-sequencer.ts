import { defineNode, registerNode } from "../../structor/node-helpers";
import {
  sequenceStructorType,
  numberType,
} from "../../structor/std-types";
import { Step } from "./types";

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
  sequence: Step[];
};

interface SequencerState {
  currentStepIndex: number;
}

export const sequencer = defineNode<{}, SeqSequencerUIConfig, any, any, SequencerState>({
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
    const sequenceRaw = config.sequence || defaultSeq;

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

registerNode(sequencer);
