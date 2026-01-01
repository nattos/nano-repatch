import { defineNode, registerNode } from "../../structor/node-helpers";
import { NumberType, AnyType } from "../../structor/type-helpers";
import { ExecutionContext } from "../../structor/structor";
import { GraphWidgetConfig } from "./types";

interface CurveEnvState {
  lastSegmentIndex: number;
}

const executeCurveEnv = (inputs: { value?: number; }, config: { config?: GraphWidgetConfig; }, context: ExecutionContext, state: CurveEnvState) => {
  // console.log('executeCurveEnv inputs:', inputs);
  const value = inputs.value ?? 0;

  // Prioritize inputs.config (runtime updates) over config.config (compiled snapshot)
  // Check all possible locations for config
  const envConfig = config?.config;

  // DEBUG SIGNALS REMOVED
  if (!envConfig ||
    !envConfig.envelopeNodes ||
    envConfig.envelopeNodes.length < 2 ||
    !envConfig.segments) {
    // If config is missing or invalid, pass through input value (Identity)
    return { result: value };
  }

  const nodes = envConfig.envelopeNodes;
  const segments = envConfig.segments || [];

  // Boundary Handling
  const firstNode = nodes[0];
  const lastNode = nodes[nodes.length - 1];

  if (value <= firstNode.x) return { result: firstNode.y };
  if (value >= lastNode.x) return { result: lastNode.y };

  // Optimization: Check cached segment index
  let segmentIndex = state.lastSegmentIndex || 0;
  // Verify cache
  if (segmentIndex >= nodes.length - 1 || value < nodes[segmentIndex].x || value >= nodes[segmentIndex + 1].x) {
    // Linear search (since cached index failed)
    for (let i = 0; i < nodes.length - 1; i++) {
      if (value >= nodes[i].x && value < nodes[i + 1].x) {
        segmentIndex = i;
        break;
      }
    }
  }
  state.lastSegmentIndex = segmentIndex;

  const p0 = nodes[segmentIndex];
  const p1 = nodes[segmentIndex + 1];
  const segment = segments[segmentIndex];

  // Normalized position in segment (0..1)
  const t = (value - p0.x) / (p1.x - p0.x);

  // Apply shaping
  let shapedT = t;
  if (segment && segment.curve) {
    const type = segment.curve.type || 'linear';
    const curveVal = segment.curve.value || 0;

    if (type === 'linear') {
      shapedT = t;
    } else if (type === 'exponential') {
      const exponent = Math.pow(10, -(curveVal ?? 0));
      // Clamp t to prevent NaN for negative t (though t should be 0..1)
      const safeT = Math.max(0, t);
      shapedT = Math.pow(safeT, exponent);
      // Implementation for other curve types can be added here if needed
      // Current implementations: exponential, linear, step, sin, quad, points
    }
  }

  // Linear interpolation on shaped time
  const result = p0.y + (p1.y - p0.y) * shapedT;

  return { result };
};

interface CurveEnvUIConfig {
  config?: GraphWidgetConfig; // Root level (canonical)
  curveData?: GraphWidgetConfig; // Alias/Legacy
  values?: {
    config?: GraphWidgetConfig;
    value?: number;
    [key: string]: any;
  };
}

type CurveEnvCompiledConfig = {
  config: typeof AnyType; // Complex object structure
};

export const curve_env = defineNode<any, CurveEnvUIConfig, CurveEnvCompiledConfig, any, CurveEnvState>({
  id: 'curve.env',
  version: '1.0.0',
  displayName: 'Curve Envelope',
  metadata: {
    category: 'Curve',
    keywords: ['envelope', 'automation', 'ramp'],
    description: 'User-editable curve envelope'
  },
  inputs: {
    value: { type: NumberType, description: 'Input value (0-1)', defaultValue: 0 }
  },
  outputs: {
    result: { type: NumberType, description: 'Output value' }
  },
  config: {
    config: { kind: 'atomic', type: 'any', defaultValue: {} }
  },
  inspectInputs: true,
  createState: (): CurveEnvState => ({
    lastSegmentIndex: 0
  }),
  autoBroadcast: true,
  compileConfig: (uiConfig) => {
    // Prefer root-level 'config' or 'curveData', fallback to values
    const sourceConfig = uiConfig.config ?? uiConfig.curveData ?? uiConfig.values?.config;

    return {
      config: sourceConfig ?? {
        domain: [0, 1],
        range: [0, 1],
        envelopeNodes: [
          { id: 'n1', x: 0, y: 0 },
          { id: 'n2', x: 1, y: 1 }
        ],
        segments: [
          { id: 's1', weight: 1, curve: { type: 'linear' } }
        ]
      }
    };
  },
  execute: executeCurveEnv
});

registerNode(curve_env);
