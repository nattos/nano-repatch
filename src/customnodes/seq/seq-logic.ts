import { defineNode, registerNode } from "../../structor/node-helpers";
import {
  sequenceStructorType,
  numberType,
} from "../../structor/std-types";
import { Step } from "./types";

interface SeqBinaryOpInputs {
  inputs: Step[][]; // Collection of sequences
}

interface SeqNegateInputs {
  seq_in: Step[];
}

const EmptyStep: Step = { noteIndex: null, velocity: 0, hold: false };
const isActive = (s: Step) => s.noteIndex !== null && s.noteIndex !== undefined;

const createBinaryOpNode = (
  id: string,
  displayName: string,
  description: string,
  op: (a: Step, b: Step) => Step
) => defineNode<any, {}, {}>({
  id: `seq.${id}`,
  version: "1.0.0",
  displayName,
  metadata: { category: 'Sequence', keywords: ['logic', id, 'binary'], description },
  config: {},
  inputs: {
    inputs: {
      type: { kind: "array", size: "dynamic", element: sequenceStructorType },
      description: "Sequences",
      allowMultiConnection: true
    }
  },
  outputs: { seq_out: sequenceStructorType },
  execute: (rawInputs: any) => {
    const inputs = (rawInputs as SeqBinaryOpInputs).inputs || [];
    if (inputs.length === 0) return { seq_out: [] };

    // Find max length for wrapping
    let len = 0;
    inputs.forEach(s => len = Math.max(len, s.length));
    if (len === 0) return { seq_out: [] };

    const outSeq: Step[] = [];

    for (let i = 0; i < len; i++) {
      // Start with Empty/Inactive accumulator
      let acc: Step = { ...EmptyStep };

      const firstSeq = inputs[0];
      if (firstSeq.length > 0) {
        acc = { ...firstSeq[i % firstSeq.length] };
      } else {
        acc = { ...EmptyStep };
      }

      for (let j = 1; j < inputs.length; j++) {
        const seq = inputs[j];
        const stepB = (seq.length > 0) ? seq[i % seq.length] : EmptyStep;
        acc = op(acc, stepB);
      }

      outSeq.push(acc);
    }

    return { seq_out: outSeq };
  }
});

export const xor = createBinaryOpNode(
  'xor', 'Sequence XOR', 'XORs multiple sequences.',
  (a, b) => {
    const aActive = isActive(a);
    const bActive = isActive(b);
    return (aActive !== bActive) ? (bActive ? b : a) : { ...EmptyStep };
  }
);

export const sub = createBinaryOpNode(
  'sub', 'Sequence Subtract', 'Subtracts subsequent sequences from the first.',
  (a, b) => isActive(b) ? { ...EmptyStep } : a
);

export const and = createBinaryOpNode(
  'and', 'Sequence AND', 'Output active only if both inputs active.',
  (a, b) => (isActive(a) && isActive(b)) ? b : { ...EmptyStep }
);

export const or = createBinaryOpNode(
  'or', 'Sequence OR', 'Output active if any input active.',
  (a, b) => isActive(b) ? b : a
);

// explicit 'any' generic used to bypass Constraint Mismatch
export const negate = defineNode<any, {}, {}>({
  id: "seq.negate",
  version: "1.0.0",
  displayName: "Sequence Negate",
  metadata: { category: 'Sequence', keywords: ['logic', 'not', 'invert'], description: 'Inverts sequence activity.' },
  config: {},
  autoBroadcast: {
    seq_in: { combine: { reduce: 'first' } }
  },
  inputs: {
    seq_in: { type: sequenceStructorType }
  },
  outputs: { seq_out: sequenceStructorType },
  execute: (rawInputs: any) => {
    // Cast raw inputs to the strict Runtime Interface
    const inputs = rawInputs as SeqNegateInputs;
    const seq = inputs.seq_in || [];
    const outSeq = seq.map((s) => {
      const step: Step = { ...s };

      if (step.noteIndex !== null) {
        step.noteIndex = null;
        step.velocity = 0;
        step.hold = false;
      } else {
        // Toggle ON (default 60, full vel)
        step.noteIndex = 60;
        step.velocity = 1;
        step.hold = false;
      }
      return step;
    });

    return { seq_out: outSeq };
  }
});

registerNode(xor);
registerNode(sub);
registerNode(and);
registerNode(or);
registerNode(negate);
