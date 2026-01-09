import { definePrimitiveNode, AnyType, unifyTypes } from '../type-helpers';
import { NodeCategory, StructorType, Structor, StructorRecord } from '../structor';
import { registerNode } from '../node-helpers';

interface DelayState {
  storedValue: any;
  initialized: boolean;
}

export const logic_delay = definePrimitiveNode({
  id: 'logic.delay',
  metadata: {
    category: NodeCategory.Logic, // Or Time? But user called it logic.delay.
    keywords: ['delay', 'z-1', 'feedback', 'memory', 'prev'],
    description: 'Outputs the value from the previous frame (z⁻¹).'
  },
  config: {
    initMode: { kind: 'atomic', type: 'string', defaultValue: 'auto' }, // 'auto' | 'manual'
  },
  inputs: {
    value: AnyType,
    init: AnyType
  },
  outputs: {
    result: AnyType // Dynamic
  },
  autoBroadcast: false, // Manual handling for logic consistency

  createState: () => ({ storedValue: undefined, initialized: false }),

  computeForwardPorts: (inputTypes, config: Structor, context) => {
    const rawConfig = (config as StructorRecord).fields;
    const initMode = rawConfig.initMode || 'auto';

    // Value Type
    const valueType = (inputTypes.fields || inputTypes).value || AnyType;
    let initType = (inputTypes.fields || inputTypes).init || AnyType;

    // If auto init, init type is not relevant (hidden), but effectively same as value
    if (initMode === 'auto') {
      initType = valueType;
    }

    const outputType = unifyTypes([valueType, initType]);

    // Construct inputs
    const inputs: any = {
      value: valueType
    };

    if (initMode === 'manual') {
      inputs.init = initType;
    }

    // Pass through implicit inputs logic for dirty propagation?
    // No, dirty propagation handles this.

    return {
      inputs: { kind: 'record', fields: inputs },
      outputs: { kind: 'record', fields: { result: outputType } }
    };
  },

  compileConfig: (uiConfig: any, metadata: any) => {
    return {
      fields: {
        initMode: uiConfig.initMode || 'auto'
      }
    };
  },

  shouldRecompileOnConfigChange: (newConfig, oldConfig) => {
    const n = newConfig as any;
    const o = oldConfig as any;
    return n.initMode !== o?.initMode;
  },

  execute: (inputs, config, context, state: DelayState) => {
    const value = inputs.value;
    const init = inputs.init;
    const initMode = config.initMode || 'auto';

    let result;

    if (state.initialized) {
      result = state.storedValue;
    } else {
      // First frame
      result = (initMode === 'auto') ? value : init;
      state.initialized = true;
    }

    // Store current value for next frame
    state.storedValue = value;

    return { result };
  }
});

registerNode({
  version: "1.0.0",
  ...logic_delay,
  inputs: {}, // Override static inputs
  displayName: 'Delay',
  extendedInputs: {
    value: { type: AnyType, description: 'Input Value' },
    init: { type: AnyType, description: 'Initial Value' }
  },
  extendedOutputs: {
    result: { type: AnyType, description: 'Delayed Value' }
  },
  ui: {
    inspector: {
      fields: [
        {
          type: 'tab-bar' as const, label: 'Init Mode', path: 'initMode', default: 'auto',
          options: [
            { label: 'Auto (Use Value)', value: 'auto' },
            { label: 'Manual', value: 'manual' }
          ]
        }
      ]
    }
  }
});
