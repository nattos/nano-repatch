import { defineNode, registerNode } from "../../structor/node-helpers";
import { numberType, midiStreamType, stringType } from "../../structor/std-types";
import { StringType } from "../../structor/type-helpers";

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

interface MathRandomUIConfig {
  mode?: string;
  seed?: number;
  values?: { mode?: string; seed?: number };
}

type MathRandomCompiledConfig = {
  mode: typeof StringType;
  seed: { kind: 'atomic', type: 'number', defaultValue?: number };
};

interface MathRandomState {
  generator: { next: () => number };
  currentValue: number;
}

export const random = defineNode<any, MathRandomUIConfig, MathRandomCompiledConfig, any, MathRandomState>({
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
    seed: { kind: 'atomic', type: 'number', defaultValue: 12345 },
    mode: { kind: 'atomic', type: 'string', defaultValue: 'on-trigger' }
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

  compileConfig: (uiConfig) => ({
    mode: uiConfig.mode || uiConfig.values?.mode || 'on-trigger',
    seed: uiConfig.seed || uiConfig.values?.seed || 12345
  }),

  computeForwardPorts: (inputTypes, uiConfig) => {
    // uiConfig is now compiled flat data
    const mode = uiConfig.mode || 'on-trigger';

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
    return (config as any).mode === 'free-run';
  },

  shouldRecompileOnConfigChange: (config) => {
    return true; // Recompile on any change
  },

  createState: (config) => {
    // config here is compiled data? No, createState receives executed data?
    // Actually GraphExecutor calls createState with node.config if available.
    // Wait, GraphExecutor `initializeState` uses `node.config`.
    // We should rely on normalized config if possible, but state init happens once.
    // We can re-extract from `config`.
    const conf = config as any;
    const seed = conf?.seed || 12345;
    const generator = lcg(seed);
    // Pre-warm?
    return {
      generator,
      currentValue: generator.next() // Initial value
    };
  },
  execute: (inputs, config, context, state) => {
    // Strict config
    const mode = config.mode || 'on-trigger';
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
