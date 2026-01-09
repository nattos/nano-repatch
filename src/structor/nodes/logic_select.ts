import { definePrimitiveNode, NumberType, AnyType, typedBroadcast, TypedBroadcastSchema, unifyTypes } from '../type-helpers';
import { NodeCategory, StructorType, Structor, StructorRecord } from '../structor';
import { numberType } from '../std-types';
import { registerNode } from '../node-helpers';



export const logic_select = definePrimitiveNode({
  id: 'logic.select',
  metadata: {
    category: NodeCategory.Logic,
    keywords: ['switch', 'case', 'mux', 'conditional', 'select'],
    description: 'Selects an output value from multiple inputs based on a control value.'
  },
  inputs: {},
  config: {
    count: { kind: 'atomic', type: 'number', defaultValue: 2 },
    mode: { kind: 'atomic', type: 'string', defaultValue: 'value' }, // 'range', 'value', 'zone'
    base: { kind: 'atomic', type: 'number', defaultValue: 0, optional: true },
    step: { kind: 'atomic', type: 'number', defaultValue: 1, optional: true },
    // Thresholds stored in config? Or inputs?
    // User: "In zone mode, there will be two additional input ports per switch case. Threshold value..."
    // So thresholds are inputs.
  },
  outputs: {
    result: AnyType // Dynamic
  },
  // AutoBroadcast is handled manually because inputs are dynamic
  autoBroadcast: false,
  // User says: "The default type for these input ports should be 'float / number'"

  computeForwardPorts: (inputTypes, config: Structor, context) => {
    const configObj = (config as StructorRecord).fields;
    const count = (configObj.count as number) || 2;
    const mode = (configObj.mode as string) || 'value';

    // Base inputs
    const inputs: any = {
      value: numberType
    };

    const valueTypes: StructorType[] = [];

    for (let i = 0; i < count; i++) {
      if (mode === 'range') {
        const portName = `val_${i}`;
        inputs[portName] = { ...numberType, description: `Case ${i + 1} Value` };
        if (inputTypes.fields && inputTypes.fields[portName]) valueTypes.push(inputTypes.fields[portName]);
      } else if (mode === 'value') {
        inputs[`match_${i}`] = { ...numberType, description: `Case ${i + 1} Match` };
        inputs[`val_${i}`] = { ...numberType, description: `Case ${i + 1} Value` };
        if (inputTypes.fields && inputTypes.fields[`val_${i}`]) valueTypes.push(inputTypes.fields[`val_${i}`]);
      } else if (mode === 'zone') {
        inputs[`threshold_${i}`] = { ...numberType, description: `Case ${i + 1} Threshold` };
        inputs[`val_${i}`] = { ...numberType, description: `Case ${i + 1} Value` };
        if (inputTypes.fields && inputTypes.fields[`val_${i}`]) valueTypes.push(inputTypes.fields[`val_${i}`]);
      }
    }

    const outputType = unifyTypes(valueTypes);

    return {
      inputs: { kind: 'record', fields: inputs },
      outputs: { kind: 'record', fields: { result: outputType } }
    };
  },

  compileConfig: (uiConfig) => {
    return {
      fields: {
        count: uiConfig.count || 2,
        mode: uiConfig.mode || 'value',
        base: uiConfig.base || 0,
        step: uiConfig.step || 1
      }
    };
  },

  shouldRecompileOnConfigChange: (newConfig, oldConfig) => {
    const n = newConfig as any;
    const o = oldConfig as any;
    return n.count !== o?.count || n.mode !== o?.mode;
  },

  execute: (rawInputs, config, context) => {
    // Manually reconstruct schema for dynamic inputs
    // config here is the Unwrapped Structor (InferRecord -> { count: number, ... })
    const count = config.count ?? 2;
    const mode = config.mode ?? 'value';
    const base = config.base ?? 0;
    const step = config.step ?? 1;

    // Schema for broadcast
    const schema: TypedBroadcastSchema = {
      value: { type: numberType }
    };

    for (let i = 0; i < count; i++) {
      const valKey = `val_${i}`;
      schema[valKey] = { type: AnyType }; // Accept any type for values

      if (mode === 'value') {
        schema[`match_${i}`] = { type: numberType };
      } else if (mode === 'zone') {
        schema[`threshold_${i}`] = { type: numberType };
      }
    }

    const inputs = typedBroadcast(context, schema, rawInputs as any);

    // Logic implementation
    const value = inputs.value ?? 0;

    let selectedIndex = -1;

    if (mode === 'range') {
      // Find closest index
      // Targets: base, base+step, base+2*step ...
      // We can solve this analytically: round((value - base) / step)
      if (step === 0) {
        selectedIndex = 0;
      } else {
        const rawIndex = Math.round((value - base) / step);
        selectedIndex = Math.max(0, Math.min(count - 1, rawIndex));
      }
    } else if (mode === 'value') {
      const epsilon = 0.0001;
      for (let i = 0; i < count; i++) {
        const matchVal = (inputs as any)[`match_${i}`] ?? (i + 1); // Default match?
        if (Math.abs(value - matchVal) < epsilon) {
          selectedIndex = i;
          break;
        }
      }
    } else if (mode === 'zone') {
      // "If input value is less than or equal to the first case's threshold"
      // Assuming sorted.
      for (let i = 0; i < count; i++) {
        const threshold = (inputs as any)[`threshold_${i}`] ?? Infinity;
        if (value <= threshold) {
          selectedIndex = i;
          break;
        }
      }
    }

    let result = 0;
    if (selectedIndex !== -1) {
      result = (inputs as any)[`val_${selectedIndex}`] ?? 0;
    } else {
      // No match? Fallback? User didn't specify. Last case? 0?
      // In switch nodes, usually default is needed.
      // For now, 0 or null? 0 is safer for numbers.
      result = 0;
    }

    return { result };
  }
});

registerNode({
  version: "1.0.0",
  ...logic_select,
  displayName: 'Select',
  extendedInputs: {
    value: { type: numberType, description: 'Control Value' }
  },
  extendedOutputs: {
    result: { type: AnyType, description: 'Selected Value' }
  },
  ui: {
    inspector: {
      fields: [
        { type: 'number' as const, label: 'Count', path: 'count', min: 2, max: 32, step: 1, default: 2 },
        {
          type: 'tab-bar' as const, label: 'Mode', path: 'mode', default: 'value',
          options: [
            { label: 'Value (Match)', value: 'value' },
            { label: 'Range (Index)', value: 'range' },
            { label: 'Zone (Threshold)', value: 'zone' }
          ]
        },
        {
          type: 'number' as const, label: 'Base Index', path: 'base', step: 1, default: 0,
          visible: (cfg: any) => cfg.mode === 'range'
        }, // For range mode
        {
          type: 'number' as const, label: 'Step Size', path: 'step', step: 1, default: 1,
          visible: (cfg: any) => cfg.mode === 'range'
        }   // For range mode
      ]
    }
  }
});
