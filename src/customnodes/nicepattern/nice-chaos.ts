import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NumberType } from "../../structor/type-helpers";
import { numberType, sequenceStructorType } from "../../structor/std-types";
import { SeededRandom } from "./utils";
import { Step } from "./envelope-generator";

const SEQUENCE_LENGTH = 16;

const ChaosFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Min Note', path: 'minNote' },
  { type: 'number', label: 'Max Note', path: 'maxNote' },
  { type: 'number', label: 'Seed', path: 'seed' }
];

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

registerNode(chaosGenerator);
