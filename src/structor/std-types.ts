import { defineType } from "./type-helpers";

export const numberType = defineType({ kind: "atomic", type: "number" });
export const stringType = defineType({ kind: "atomic", type: "string" });
export const booleanType = defineType({ kind: "atomic", type: "boolean" });
export const anyType = defineType({ kind: "atomic", type: "any" });

export const midiEventType = defineType({
  kind: "record",
  fields: {
    status: numberType,
    data1: numberType,
    data2: numberType,
    time: numberType,
  },
  untagged: [],
  hint: 'midi'
});

export const midiStreamType = defineType({
  kind: "array",
  size: "dynamic",
  element: midiEventType,
  hint: 'midi-stream'
});
