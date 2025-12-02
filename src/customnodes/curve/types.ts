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
                  fields: { x: NumberType, y: NumberType },
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
});
