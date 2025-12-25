import { defineRecordType, NumberType, StringType } from "../../structor/type-helpers";

export type CurveType = 'exponential' | 'linear' | 'step' | 'sin' | 'quad' | 'points';

export interface GraphSegment {
  id: string;
  weight: number;
  curve: {
    type: CurveType;
    value?: number;
    points?: { x: number, y: number }[];
  };
}

export interface GraphWidgetConfig {
  domain: [number, number];
  range: [number, number];
  segments: GraphSegment[];
  envelopeNodes?: { id: string, x: number, y: number }[];
}

export const curveStructorType = defineRecordType<GraphWidgetConfig>({
  kind: 'record',
  fields: {
    domain: { kind: 'array', element: NumberType, size: 2 },
    range: { kind: 'array', element: NumberType, size: 2 },
    segments: {
      kind: 'array',
      element: {
        kind: 'record',
        fields: {
          id: { kind: 'atomic', type: 'string' },
          weight: NumberType,
          curve: {
            kind: 'record',
            fields: {
              type: { kind: 'atomic', type: 'string' },
              value: { ...NumberType, optional: true },
              points: {
                kind: 'array',
                element: {
                  kind: 'record',
                  fields: { x: NumberType, y: NumberType }
                },
                optional: true,
                size: 'dynamic'
              }
            }
          }
        }
      },
      size: 'dynamic'
    },
    envelopeNodes: {
      kind: 'array',
      element: {
        kind: 'record',
        fields: {
          id: { kind: 'atomic', type: 'string' },
          x: NumberType,
          y: NumberType
        }
      },
      optional: true,
      size: 'dynamic'
    }
  },
  hint: 'curve'
});
