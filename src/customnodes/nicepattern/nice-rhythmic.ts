import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NumberType } from "../../structor/type-helpers";
import { numberType, sequenceStructorType } from "../../structor/std-types";
import { Step } from "./envelope-generator";

const SEQUENCE_LENGTH = 16;

const RhythmicFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Target Note', path: 'targetNote' }
];

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

registerNode(rhythmicGenerator);
