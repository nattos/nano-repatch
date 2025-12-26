import { defineNode, registerNode } from "../../structor/node-helpers";
import { numberType, midiStreamType, stringType } from "../../structor/std-types";

// Simple LCG PRNG
function lcg(seed: number) {
  const m = 0x80000000;
  const a = 1103515245;
  const c = 12345;
  let state = seed ? seed : Math.floor(Math.random() * (m - 1));

  return {
    next: () => {
      state = (a * state + c) % m;
      return state / (m - 1);
    }
  };
}

export const random = defineNode({
  id: "math.random",
  version: "1.1.0",
  displayName: "Random",
  metadata: {
    category: 'Math',
    keywords: ['random', 'stochastic', 'noise', 'seed', 'white'],
    description: 'Generates a random number (0-1). Supports on-trigger or free-run modes.'
  },
  // Used for autoBroadcast compilation mainly
  inputs: {
    trigger: { type: midiStreamType, description: 'Trigger Signal', allowMultiConnection: true }
  },
  config: {
    seed: { ...numberType, defaultValue: 12345 },
    mode: { ...stringType, defaultValue: 'on-trigger' }
  },
  outputs: {
    value: { type: numberType, description: 'Random Value' }
  },
  autoBroadcast: {
    trigger: { combine: { reduce: 'flatten' } }
  },

  // UI Configuration
  ui: {
    inspector: {
      fields: [
        {
          type: 'tab-bar',
          label: 'Mode',
          path: 'mode',
          options: [
            { label: 'On Trigger', value: 'on-trigger' },
            { label: 'Free Run', value: 'free-run' }
          ],
          default: 'on-trigger'
        },
        { type: 'number', label: 'Seed', path: 'seed', default: 12345 }
      ]
    }
  },

  computeForwardPorts: (inputTypes, config, context) => {
    const rawConfig = config as any;
    // Access pattern aligned with curve.crop
    const mode = rawConfig?.mode || rawConfig?.values?.mode || 'on-trigger';

    const inputs: any = {};

    if (mode === 'on-trigger') {
      inputs['trigger'] = { type: midiStreamType, description: 'Trigger Signal', allowMultiConnection: true };
    }

    return {
      inputs: { kind: 'record', fields: inputs },
      outputs: { kind: 'record', fields: { value: numberType } }
    };
  },

  isRealtime: (config) => {
    const rawConfig = config as any;
    const mode = rawConfig?.mode || rawConfig?.values?.mode || rawConfig?.fields?.mode;
    return mode === 'free-run';
  },

  shouldRecompileOnConfigChange: (config) => {
    return true; // Recompile on any change
  },

  createState: (config) => {
    const rawConfig = config as any;
    const seed = rawConfig?.seed || rawConfig?.values?.seed || rawConfig?.fields?.seed || 12345;
    const generator = lcg(seed);
    // Pre-warm?
    return {
      generator,
      currentValue: generator.next() // Initial value
    };
  },
  execute: (inputs, config, context, state) => {
    const rawConfig = config as any;
    const mode = rawConfig?.mode || rawConfig?.values?.mode || rawConfig?.fields?.mode || 'on-trigger';
    const stream = inputs.trigger;

    if (mode === 'free-run') {
      // Generate new value every frame
      state.currentValue = state.generator.next();
    } else if (Array.isArray(stream)) {
      // mode === 'on-trigger'
      for (const e of stream) {
        if (e.type === 'note_on' && (e.velocity ?? 0) > 0) {
          // Logic: Advance generator on every Note On.
          // Effectively outputs the last generated value for this frame.
          state.currentValue = state.generator.next();
        }
      }
    }

    return { value: state.currentValue };
  }
});

registerNode(random);
