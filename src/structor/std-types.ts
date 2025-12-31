import { defineType } from "./type-helpers";

export const numberType = defineType({ kind: "atomic", type: "number", defaultValue: 0 } as const);
export const stringType = defineType({ kind: "atomic", type: "string" } as const);
export const booleanType = defineType({ kind: "atomic", type: "boolean" });
export const anyType = defineType({ kind: "atomic", type: "any" });

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
});

export const midiStreamType = defineType({
  kind: "array",
  size: "dynamic",
  element: midiEventType,
  hint: 'midi-stream'
});

export const vec2Type = defineType({
  kind: "array",
  element: numberType,
  size: 2,
  hint: "vec2"
});

export const vec3Type = defineType({
  kind: "array",
  element: numberType,
  size: 3,
  hint: "vec3"
});

export const vec4Type = defineType({
  kind: "array",
  element: numberType,
  size: 4,
  hint: "vec4"
});


// Note & Sequence Types (moved from nicepattern)

export const noteStructorType = defineType({
  kind: "record",
  fields: {
    note: numberType,
    velocity: numberType,
  },
  untagged: [],
});

export const noteEventStructorType = defineType({
  kind: "record",
  fields: {
    onNote: { ...noteStructorType, optional: true },
    offNote: { ...noteStructorType, optional: true },
    hold: booleanType,
  },
  untagged: [],
});

export const stepStructorType = defineType({
  kind: "record",
  fields: {
    noteIndex: anyType, // Can be number | null
    velocity: numberType,
    hold: booleanType,
  },
  untagged: [],
});

export const sequenceStructorType = defineType({
  kind: "array",
  size: "dynamic",
  element: stepStructorType,
  hint: 'step-sequence'
});

export type UIConfigStructorType = 'float' | 'float2' | 'float3' | 'float4' | 'midi-stream' | 'string' | 'any';
