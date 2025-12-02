import { definePrimitiveNode } from "../../structor/type-helpers";
import { numberType } from "../../structor/std-types";
import { NodeCategory, RecordType } from "../../structor/structor";
import { defaultNodeRepository } from "../../structor/repository";

// Define local interfaces to match GraphWidgetConfig structure
// We don't import from views to avoid circular dependencies/browser-only code in workers
type CurveType = 'exponential' | 'linear' | 'step' | 'sin' | 'quad' | 'points';

interface GraphSegment {
  id: string;
  weight: number;
  curve: {
    type: CurveType;
    value?: number;
    points?: { x: number, y: number }[];
  };
}

interface GraphWidgetConfig {
  domain: [number, number];
  range: [number, number];
  segments: GraphSegment[];
}

const curveStructorType: RecordType = {
  kind: 'record',
  fields: {
    domain: { kind: 'array', element: numberType, size: 2 },
    range: { kind: 'array', element: numberType, size: 2 },
    segments: {
      kind: 'array',
      element: {
        kind: 'record',
        fields: {
          id: { kind: 'atomic', type: 'string' },
          weight: numberType,
          curve: {
            kind: 'record',
            fields: {
              type: { kind: 'atomic', type: 'string' },
              value: { ...numberType, optional: true },
              points: {
                kind: 'array',
                element: {
                  kind: 'record',
                  fields: { x: numberType, y: numberType },
                  untagged: []
                },
                optional: true,
                size: 'dynamic'
              }
            },
            untagged: []
          }
        },
        untagged: []
      },
      size: 'dynamic'
    }
  },
  untagged: [],
  hint: 'curve'
};

export const curve_ease = definePrimitiveNode({
  id: 'curve.ease',
  metadata: {
    category: NodeCategory.Math, // Or a new 'Curve' category if available
    keywords: ['curve', 'ease', 'envelope', 'shape'],
    description: 'Applies a custom curve easing to the input value.'
  },
  inputs: {
    value: numberType,
    easing: { ...curveStructorType, optional: true }
  },
  config: {},
  outputs: {
    result: numberType
  },
  autoBroadcast: true,
  execute: (inputs, config) => {
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
              const p2 = points[i+1];
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
  }
});

defaultNodeRepository.register({
  id: "curve.ease",
  version: "1.0.0",
  displayName: "Curve Ease",
  definition: curve_ease,
  inputs: [
    { name: "value", type: numberType, description: "Input value (0-1)" },
    { name: "easing", type: curveStructorType, description: "Easing Curve Configuration", suppressInputEditor: true }
  ],
  outputs: [{ name: "result", type: numberType, description: "Eased value" }],
  compileConfig: (uiConfig) => {
    // If uiConfig has easing, use it. Otherwise use default.
    // The definePrimitiveNode handles defaultValue, but here we map UI config to runtime config.
    // If uiConfig is just the raw object from the widget, we pass it through.
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
  }
});
