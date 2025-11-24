import { defineType } from "./type-helpers";

export const numberType = defineType({ kind: "atomic", type: "number" });
export const stringType = defineType({ kind: "atomic", type: "string" });
export const booleanType = defineType({ kind: "atomic", type: "boolean" });
export const anyType = defineType({ kind: "atomic", type: "any" });
