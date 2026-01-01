import { defineNode, registerNode } from "../../structor/node-helpers";
import { numberType } from "../../structor/std-types";

interface SawtoothState {
  phase: number;
}

export const sawtooth = defineNode({
  id: "gen.sawtooth",
  version: "1.0.0",
  displayName: "Sawtooth",
  metadata: {
    category: 'Oscillator',
    keywords: ['oscillator', 'sawtooth', 'ramp', 'lfo', 'generator'],
    description: 'Generates a linear sawtooth wave (0.0 to 1.0) at the given frequency.'
  },
  inputs: {
    freq: {
      type: numberType,
      defaultValue: 1.0,
      range: [0, 60],
      description: 'Frequency in Hz'
    }
  },
  outputs: { out: numberType },
  autoBroadcast: true,
  isRealtime: () => true,
  createState: (): SawtoothState => ({
    phase: 0
  }),
  execute: (inputs, config, context, state) => {
    const freq = inputs.freq;
    const dt = context.clock.dt;

    if (freq >= 60.0 - 1e-6) {
      return { out: Math.random() };
    }

    // Accumulate phase
    state.phase += dt * freq;
    state.phase -= Math.floor(state.phase);

    return { out: state.phase };
  },
});

registerNode(sawtooth);
