import { defineType } from "../../structor/type-helpers";
import { sequenceStructorType } from "../../structor/std-types";

export const manySequencesType = defineType({
  kind: "array",
  size: "dynamic", // Technically Array<Sequence>
  element: sequenceStructorType
});

export const layerOutputStructorType = defineType({ kind: "atomic", type: "number" });
