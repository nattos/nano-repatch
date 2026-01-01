import { defineNode, registerNode } from "../../structor/node-helpers";
import { NumberType, StringType } from "../../structor/type-helpers";
import { StructorType } from "../../structor/structor";

interface CurveCropUIConfig {
  mode?: string;
  values?: Record<string, any>;
}

// Runtime Configuration Schema
type CurveCropCompiledConfig = {
  mode: typeof StringType;
};

const curveCropInputs = {
  value: { type: NumberType, defaultValue: 0 },
  start: { type: NumberType, defaultValue: 0 },
  end: { type: NumberType, defaultValue: 1, optional: true },
  length: { type: NumberType, defaultValue: 1, optional: true }
};

export const curve_crop = defineNode({
  id: 'curve.crop',
  version: '1.0.0',
  displayName: 'Curve Crop',
  metadata: {
    category: 'Curve',
    keywords: ['crop', 'slice', 'remap', 'linear'],
    description: 'Linear mapping from 0-1 to start-end range.'
  },
  config: {
    mode: { kind: 'atomic', type: 'string', defaultValue: 'start-end' }
  },
  // Dynamic inputs based on mode
  computeForwardPorts: (inputTypes, uiConfig, context) => {
    // Mode is at root level config (set by inspector or compileConfig)
    const mode = uiConfig.mode || 'start-end';

    const fields: Record<string, StructorType> = {
      value: { ...NumberType, description: 'Input value (0-1)', defaultValue: 0 },
      start: { ...NumberType, description: 'Output at 0', defaultValue: 0 }
    };

    if (mode === 'start-length') {
      fields['length'] = { ...NumberType, description: 'Length of crop', defaultValue: 1 };
    } else {
      // Default: start-end
      fields['end'] = { ...NumberType, description: 'Output at 1', defaultValue: 1 };
    }

    return {
      inputs: { kind: 'record', fields },
      outputs: { kind: 'record', fields: { result: NumberType } }
    };
  },
  // Static inputs definition required for autoBroadcast to work
  inputs: curveCropInputs,
  outputs: { result: { type: NumberType } }, // Handled by computeForwardPorts, but kept for metadata

  // UI Configuration for Inspector
  // @ts-ignore
  ui: {
    inspector: {
      fields: [
        {
          type: 'tab-bar',
          label: 'Mode',
          path: 'mode',
          options: [
            { label: 'Start / End', value: 'start-end' },
            { label: 'Start / Length', value: 'start-length' }
          ]
        }
      ]
    }
  },

  compileConfig: (uiConfig: CurveCropUIConfig) => {
    // Return Flat Data Structure (handled by GraphExecutor normalization and valid for ComputeForwardPorts)
    const mode = uiConfig.mode || 'start-end';
    return {
      mode: mode
    };
  },

  autoBroadcast: true,
  inspectInputs: true,
  execute: (inputs, config, context) => {
    // config corresponds to the return type of compileConfig
    const mode = config.mode || 'start-end';

    const start = inputs.start ?? 0;
    const val = inputs.value ?? 0;
    let end: number;

    if (mode === 'start-length') {
      const length = inputs.length ?? 1;
      end = start + length;
    } else {
      end = inputs.end ?? 1;
    }

    // Enforce end >= start
    if (end < start) end = start;

    // Crop (Remap val from [start, end] to [0, 1])
    let result = 0;
    const range = end - start;

    if (range < 0.000001) {
      // Range is effectively zero. Step function?
      // If val >= start, 1, else 0? Or just 0?
      // Let's assume standard step behavior at start.
      result = val >= start ? 1 : 0;
    } else {
      // (val - start) / (end - start)
      const t = (val - start) / range;
      // Clamp result to 0-1
      result = Math.max(0, Math.min(1, t));
    }

    // Pass resolved 'end' to UI so it can render correctly without knowing the mode logic
    // Actually, UI needs to know if it's connected or not to fallback.
    // But passing 'end' explicitly helps the UI visualization be consistent.
    return {
      outputs: { result },
      ui: { start, end }
    };
  },
  shouldRecompileOnConfigChange: (uiConfig) => {
    // Recompile if mode changes to update ports.
    // While this might recompile on slider drags (if they are part of the same config object),
    // it is necessary for structural correctness when mode changes.
    return true;
  }
});

registerNode(curve_crop);
