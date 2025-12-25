import { defineNode, registerNode } from "../../structor/node-helpers";
import { NumberType } from "../../structor/type-helpers";
import { NodeCategory } from "../../structor/structor";
import { curveStructorType, GraphWidgetConfig } from "./types";

const executeCurveEase = (inputs: any, config: any) => {
  const value = inputs.value as number;
  // Use input easing if provided
  const easingConfig = inputs.easing as GraphWidgetConfig;

  if (!easingConfig || !easingConfig.segments || easingConfig.segments.length === 0) {
    return { result: value };
  }

  const { domain, range, segments } = easingConfig;
  const [minIn, maxIn] = domain;
  const [minOut, maxOut] = range;

  // Normalize input to 0-1 based on domain
  // If domain is 0-1, t = value
  let t = (value - minIn) / (maxIn - minIn);

  // Clamp t to 0-1 for safety (or should we extrapolate? usually easing is clamped)
  t = Math.max(0, Math.min(1, t));

  // Find segment
  const totalWeight = segments.reduce((sum, s) => sum + s.weight, 0) || 1;
  let currentT = 0;
  let matchedSegment = segments[segments.length - 1]; // Default to last
  let segmentStartT = 0;
  let segmentWidthT = 0;

  for (const segment of segments) {
    const widthT = segment.weight / totalWeight;
    if (t >= currentT && t <= currentT + widthT) {
      matchedSegment = segment;
      segmentStartT = currentT;
      segmentWidthT = widthT;
      break;
    }
    currentT += widthT;
  }

  // Normalize t within segment (0-1)
  // tInSegment = (t - segmentStartT) / segmentWidthT
  const tInSegment = (t - segmentStartT) / segmentWidthT;

  // Evaluate curve
  let normY = 0;
  const curve = matchedSegment.curve;
  const steps = curve.type === 'step' ? (curve.value ?? 2) : 1;

  switch (curve.type) {
    case 'exponential':
      // Map value (-1 to 1) to exponent
      // exponent = 10^(-value)
      const exponent = Math.pow(10, -(curve.value ?? 0));
      normY = Math.pow(tInSegment, exponent);
      break;
    case 'linear':
      normY = tInSegment;
      break;
    case 'step':
      if (steps <= 1) normY = 0;
      else normY = Math.floor(tInSegment * steps) / (steps - 1);
      if (tInSegment >= 0.999) normY = 1;
      break;
    case 'sin':
      // EaseInOutSine: -(cos(PI * x) - 1) / 2
      normY = -(Math.cos(Math.PI * tInSegment) - 1) / 2;
      break;
    case 'quad':
      // EaseInQuad: t * t
      normY = tInSegment * tInSegment;
      break;
    case 'points':
      if (curve.points && curve.points.length > 0) {
        // Linear interpolation between points
        // Points are sorted by x? Assuming yes based on user request "sorted"
        // Find p1, p2 such that p1.x <= tInSegment <= p2.x
        const points = curve.points;
        if (tInSegment <= points[0].x) normY = points[0].y;
        else if (tInSegment >= points[points.length - 1].x) normY = points[points.length - 1].y;
        else {
          for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            if (tInSegment >= p1.x && tInSegment <= p2.x) {
              const localT = (tInSegment - p1.x) / (p2.x - p1.x);
              normY = p1.y + localT * (p2.y - p1.y);
              break;
            }
          }
        }
      } else {
        normY = tInSegment;
      }
      break;
    default:
      normY = tInSegment;
  }

  // Map to output range
  const result = minOut + normY * (maxOut - minOut);

  return { result };
};

export const curve_ease = defineNode({
  id: 'curve.ease',
  version: '1.0.0',
  displayName: 'Curve Ease',
  metadata: {
    category: NodeCategory.Math,
    keywords: ['curve', 'ease', 'envelope', 'shape'],
    description: 'Applies a custom curve easing to the input value.'
  },
  inputs: {
    value: { type: NumberType, description: 'Input value (0-1)', defaultValue: 0 },
    easing: {
      type: { ...curveStructorType, optional: true },
      description: 'Easing Curve Configuration',
      suppressInputEditor: true
    }
  },
  outputs: {
    result: NumberType
  },
  autoBroadcast: true,
  inspectInputs: true,
  /* UI registered in register-ui.ts */
  compileConfig: (uiConfig) => {
    return {
      fields: {
        easing: uiConfig?.easing ?? {
          domain: [0, 1],
          range: [0, 1],
          segments: [{
            id: 's1',
            weight: 1,
            curve: { type: 'exponential', value: 0 }
          }]
        }
      },
      untagged: []
    };
  },
  execute: executeCurveEase
});

registerNode(curve_ease);

export const curve_ease4 = defineNode({
  id: 'curve.ease4',
  version: '1.0.0',
  displayName: 'Curve Ease 4',
  metadata: {
    category: NodeCategory.Math,
    keywords: ['curve', 'ease', 'envelope', 'shape', 'multi'],
    description: 'Applies a custom 4-segment curve easing to the input value.'
  },
  inputs: {
    value: { type: NumberType, description: 'Input value (0-1)', defaultValue: 0 },
    easing: {
      type: { ...curveStructorType, optional: true },
      description: 'Easing Curve Configuration',
      suppressInputEditor: true,
      defaultValue: {
        domain: [0, 1],
        range: [0, 1],
        segments: [
          { id: 's1', weight: 1, curve: { type: 'exponential', value: 0.5 } },
          { id: 's2', weight: 1, curve: { type: 'exponential', value: 0.0 } },
          { id: 's3', weight: 1, curve: { type: 'exponential', value: -0.5 } },
          { id: 's4', weight: 1, curve: { type: 'exponential', value: -1.0 } }
        ]
      }
    }
  },
  outputs: {
    result: NumberType
  },
  autoBroadcast: true,
  inspectInputs: true,
  /* UI registered in register-ui.ts */
  compileConfig: (uiConfig) => {
    return {
      fields: {
        easing: uiConfig?.easing ?? {
          domain: [0, 1],
          range: [0, 1],
          segments: [
            { id: 's1', weight: 1, curve: { type: 'exponential', value: 0.5 } },
            { id: 's2', weight: 1, curve: { type: 'exponential', value: 0.0 } },
            { id: 's3', weight: 1, curve: { type: 'exponential', value: -0.5 } },
            { id: 's4', weight: 1, curve: { type: 'exponential', value: -1.0 } }
          ]
        }
      },
      untagged: []
    };
  },
  execute: executeCurveEase
});

registerNode(curve_ease4);
interface CurveEnvState {
  lastSegmentIndex: number;
}

interface NodeStorageConfig {
  values?: {
    config?: GraphWidgetConfig;
    [key: string]: any;
  };
}

const inputs = {
  value: { type: NumberType, description: 'Input value (0-1)', defaultValue: 0 }
};

const executeCurveEnv = (inputs: any, config: any, context: any, state: CurveEnvState) => {
  const value = inputs.value as number;

  // Prioritize inputs.config (runtime updates) over config.config (compiled snapshot)
  // Check all possible locations for config
  const envConfig = (
    inputs.config ||
    config?.values?.config ||
    config?.fields?.config ||
    config?.config
  ) as GraphWidgetConfig;

  // DEBUG SIGNALS
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
    } else if (type === 'ease_in_out') {
      // Sine ease in out
      shapedT = -(Math.cos(Math.PI * t) - 1) / 2;
      // Apply tension/bias if needed, but basic ease first
      if (Math.abs(curveVal) > 0.001) {
        // Simple power curve for tension?
        // shapedT = Math.pow(t, 2 ** curveVal) ?
        // For now just standard ease + mix?
      }
    } else if (type === 'power') { // Custom power/exponent logic if implemented
      // ...
    }
  }

  // Linear interpolation on shaped time
  const result = p0.y + (p1.y - p0.y) * shapedT;

  return { result };
};

export const curve_env = defineNode({
  id: 'curve.env',
  version: '1.0.0',
  displayName: 'Curve Envelope',
  metadata: {
    category: NodeCategory.Math,
    keywords: ['curve', 'envelope', 'shape', 'env'],
    description: 'Freeform parametric envelope.'
  },
  inputs,
  config: {
    config: { ...curveStructorType, optional: true }
  },
  outputs: {
    result: NumberType
  },
  createState: () => ({
    lastSegmentIndex: 0
  }),
  autoBroadcast: true,
  inspectInputs: true,
  /* UI registered in register-ui.ts */
  compileConfig: (uiConfig: NodeStorageConfig) => {
    // We prefer 'curveData' (root-level config for triggering compilation)
    // Fallback to 'values.config' for backward compatibility
    const sourceConfig = uiConfig?.curveData ?? uiConfig?.values?.config;

    return {
      fields: {
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
      }
    };
  },
  execute: executeCurveEnv
});

registerNode(curve_env);
