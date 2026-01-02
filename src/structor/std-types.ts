import { defineType } from "./type-helpers";

export const numberType = defineType({ kind: "atomic", type: "number", defaultValue: 0 } as const);
export const stringType = defineType({ kind: "atomic", type: "string" } as const);
export const booleanType = defineType({ kind: "atomic", type: "boolean" } as const);
export const anyType = defineType({ kind: "atomic", type: "any" } as const);

export const midiEventType = defineType({
  kind: "record",
  fields: {
    type: stringType,
    channel: numberType,
    deviceId: { ...stringType, optional: true },
    time: { ...numberType, optional: true },
    // Union fields
    note: { ...numberType, optional: true },
    velocity: { ...numberType, optional: true },
    cc: { ...numberType, optional: true },
    value: { ...numberType, optional: true }
  },
  hint: 'midi'
} as const);

export const midiStreamType = defineType({
  kind: "array",
  size: "dynamic",
  element: midiEventType,
  hint: 'midi-stream'
} as const);

export const float2Type = defineType({
  kind: "array",
  element: numberType,
  size: 2,
  hint: "float2"
} as const);

export const float3Type = defineType({
  kind: "array",
  element: numberType,
  size: 3,
  hint: "float3"
} as const);

export const float4Type = defineType({
  kind: "array",
  element: numberType,
  size: 4,
  hint: "float4"
} as const);


// Note & Sequence Types (moved from nicepattern)

export const noteStructorType = defineType({
  kind: "record",
  fields: {
    note: numberType,
    velocity: numberType,
  },
  untagged: [],
} as const);

export const noteEventStructorType = defineType({
  kind: "record",
  fields: {
    onNote: { ...noteStructorType, optional: true },
    offNote: { ...noteStructorType, optional: true },
    hold: booleanType,
  },
  untagged: [],
} as const);

export const stepStructorType = defineType({
  kind: "record",
  fields: {
    noteIndex: anyType, // Can be number | null
    velocity: numberType,
    hold: booleanType,
  },
  untagged: [],
} as const);

export const sequenceStructorType = defineType({
  kind: "array",
  size: "dynamic",
  element: stepStructorType,
  hint: 'step-sequence'
} as const);

export type UIConfigStructorType = 'float' | 'float2' | 'float3' | 'float4' | 'midi-stream' | 'string' | 'any';
