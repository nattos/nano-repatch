import { definePrimitiveNode, AnyType, unifyTypes } from '../type-helpers';
import { NodeCategory, StructorType, Structor, StructorRecord } from '../structor';
import { midiStreamType } from '../std-types';
import { registerNode } from '../node-helpers';
import { detectTriggerMode, shouldTrigger, TriggerMode } from '../trigger-helpers';

interface LatchState {
  currentValue: any;
  initialized: boolean;
}

export const logic_latch = definePrimitiveNode({
  id: 'logic.latch',
  metadata: {
    category: NodeCategory.Logic,
    keywords: ['latch', 'sample', 'hold', 'trigger', 'store'],
    description: 'Stores and outputs a value when the trigger condition is met.'
  },
  config: {
    initMode: { kind: 'atomic', type: 'string', defaultValue: 'auto' }, // 'auto' | 'manual'
    mode: { kind: 'atomic', type: 'string', defaultValue: 'midi', optional: true } // trigger mode
  },
  inputs: {
    condition: midiStreamType, // Dynamic
    value: AnyType,
    init: AnyType
  },
  outputs: {
    result: AnyType // Dynamic
  },
  autoBroadcast: false, // We handle execution logic manually?
  // Actually, Latch logic is usually valid for scalar/broadcast if condition is also broadcast?
  // But trigger logic "shouldTrigger" is often looking at the stream as a whole.
  // If we broadcast, we get simple scalar logic.
  // But detectTriggerMode handles streams.
  // Let's stick to execute with raw inputs to be safe and consistent with logic.select/core.ifthen.

  createState: () => ({ currentValue: undefined, initialized: false }),

  computeForwardPorts: (inputTypes, config: Structor, context) => {
    // Lifecycle methods receive the raw stored Structor (Wrapped)
    const rawConfig = (config as StructorRecord).fields;
    const initMode = rawConfig.initMode || 'auto';

    // Detect Trigger Mode
    const conditionType = (inputTypes.fields || inputTypes).condition;
    const triggerMode = detectTriggerMode(conditionType);

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
      condition: conditionType || midiStreamType,
      value: valueType
    };

    if (initMode === 'manual') {
      inputs.init = initType;
    }

    return {
      inputs: { kind: 'record', fields: inputs },
      outputs: { kind: 'record', fields: { result: outputType } },
      forwardMetadata: { mode: triggerMode }
    };
  },

  compileConfig: (uiConfig: any, metadata: any) => {
    return {
      fields: {
        initMode: uiConfig.initMode || 'auto',
        mode: metadata?.mode || 'midi'
      }
    };
  },

  shouldRecompileOnConfigChange: (newConfig, oldConfig) => {
    // Lifecycle methods receive the UI Config (Unwrapped)
    const n = newConfig as any;
    const o = oldConfig as any;
    return n.initMode !== o?.initMode;
  },

  execute: (inputs: any, config: any, context, state: LatchState) => {
    // execute receives the Unwrapped/Marshalled config (fromStructor)

    // Inputs: fields.condition, fields.value, fields.init
    const condition = inputs.condition;
    const value = inputs.value;
    const init = inputs.init;

    // Config is already unwrapped
    const mode = config.mode || 'midi';
    const initMode = config.initMode || 'auto';

    if (shouldTrigger(condition, mode as TriggerMode)) {
      state.currentValue = value;
      state.initialized = true;
    }

    let result = state.currentValue;

    if (!state.initialized) {
      if (initMode === 'auto') {
        result = value; // Pass through if not latched yet?
        // "When the node state is new, if the condition is not truthy, then it will store the init value"
        // If auto, init value IS value.
        // But does it store it? "store the init value".
        // Implementation: just output it.
        // Wait, "store" implies it becomes the latched value?
        // "It will also take a value input, and an init input... internal value will update whenever condition is truthy... if condition is not truthy, then it will store the init value"
        // This phrasing "if condition is not truthy, it will store init" implies initialization logic.
        // Usually Latch initializes to Init input ONCE.
        // Or does it latch init on first frame?
        // "When the node state is new..." implies initialization step.

        // Logic:
        // if (!initialized) {
        //    state.currentValue = initMode === 'auto' ? value : init;
        //    state.initialized = true;
        // }
        // BUT, if shouldTrigger is true, we overwrite it.
        // Correct order:
        // 1. If trigger -> update state.
        // 2. If !initialized -> set state to init (and mark initialized).
        // Return state.

        // Re-reading: "When the node state is new, if the condition is not truthy, then it will store the init value"
        // Yes.
      }

      // If not triggered this frame:
      if (!state.initialized) {
        state.currentValue = (initMode === 'auto') ? value : init;
        state.initialized = true;
        result = state.currentValue;
      }
    }

    return { result };
  }
});

registerNode({
  version: "1.0.0",
  ...logic_latch,
  inputs: {}, // Override static inputs to ensure RAW execution (like logic.select)
  displayName: 'Latch',
  extendedInputs: {
    condition: { type: midiStreamType, description: 'Trigger' },
    value: { type: AnyType, description: 'Value to Latch' },
    init: { type: AnyType, description: 'Initial Value' }
  },
  extendedOutputs: {
    result: { type: AnyType, description: 'Latched Value' }
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
