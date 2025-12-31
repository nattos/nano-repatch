import { registerNode } from '../node-helpers';
import { defineMathNode } from '../type-helpers';
import { NodeCategory } from '../structor';
import { numberType } from '../std-types';

export const primitive_abs = defineMathNode(
  'math.abs',
  { category: NodeCategory.Math, keywords: ['absolute', 'magnitude'], description: 'Returns the absolute value of a.' },
  (a) => Math.abs(a),
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_abs,
  displayName: 'Abs',
  extendedInputs: { a: { type: numberType, description: 'Value' } },
  extendedOutputs: { result: { type: numberType, description: 'Absolute Value' } }
});

export const primitive_negate = defineMathNode(
  'math.negate',
  { category: NodeCategory.Math, keywords: ['negative', 'invert'], description: 'Negates a.' },
  (a) => -a,
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_negate,
  displayName: 'Negate',
  extendedInputs: { a: { type: numberType, description: 'Value' } },
  extendedOutputs: { result: { type: numberType, description: 'Negated Value' } }
});

export const primitive_ceil = defineMathNode(
  'math.ceil',
  { category: NodeCategory.Math, keywords: ['ceiling', 'round up'], description: 'Rounds a up to the nearest integer.' },
  (a) => Math.ceil(a),
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_ceil,
  displayName: 'Ceil',
  extendedInputs: { a: { type: numberType, description: 'Value' } },
  extendedOutputs: { result: { type: numberType, description: 'Ceiling' } }
});

export const primitive_floor = defineMathNode(
  'math.floor',
  { category: NodeCategory.Math, keywords: ['floor', 'round down'], description: 'Rounds a down to the nearest integer.' },
  (a) => Math.floor(a),
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_floor,
  displayName: 'Floor',
  extendedInputs: { a: { type: numberType, description: 'Value' } },
  extendedOutputs: { result: { type: numberType, description: 'Floor' } }
});

export const primitive_round = defineMathNode(
  'math.round',
  { category: NodeCategory.Math, keywords: ['round', 'nearest'], description: 'Rounds a to the nearest integer.' },
  (a) => Math.round(a),
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_round,
  displayName: 'Round',
  extendedInputs: { a: { type: numberType, description: 'Value' } },
  extendedOutputs: { result: { type: numberType, description: 'Rounded Value' } }
});

export const primitive_sin = defineMathNode(
  'math.sin',
  { category: NodeCategory.Math, keywords: ['sine'], description: 'Returns the sine of a (radians).' },
  (a) => Math.sin(a),
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_sin,
  displayName: 'Sin',
  extendedInputs: { a: { type: numberType, description: 'Value (Radians)' } },
  extendedOutputs: { result: { type: numberType, description: 'Sine' } }
});

export const primitive_cos = defineMathNode(
  'math.cos',
  { category: NodeCategory.Math, keywords: ['cosine'], description: 'Returns the cosine of a (radians).' },
  (a) => Math.cos(a),
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_cos,
  displayName: 'Cos',
  extendedInputs: { a: { type: numberType, description: 'Value (Radians)' } },
  extendedOutputs: { result: { type: numberType, description: 'Cosine' } }
});

export const primitive_tan = defineMathNode(
  'math.tan',
  { category: NodeCategory.Math, keywords: ['tangent'], description: 'Returns the tangent of a (radians).' },
  (a) => Math.tan(a),
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_tan,
  displayName: 'Tan',
  extendedInputs: { a: { type: numberType, description: 'Value (Radians)' } },
  extendedOutputs: { result: { type: numberType, description: 'Tangent' } }
});

export const primitive_sqrt = defineMathNode(
  'math.sqrt',
  { category: NodeCategory.Math, keywords: ['square root'], description: 'Returns the square root of a.' },
  (a) => Math.sqrt(a),
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_sqrt,
  displayName: 'Sqrt',
  extendedInputs: { a: { type: numberType, description: 'Value' } },
  extendedOutputs: { result: { type: numberType, description: 'Square Root' } }
});

export const primitive_not = defineMathNode(
  'logic.not',
  { category: NodeCategory.Logic, keywords: ['!', 'invert'], description: 'Logical NOT (1 if zero, 0 if non-zero).' },
  (a) => (a === 0) ? 1 : 0,
  'unary'
);
registerNode({
  version: "1.0.0",
  ...primitive_not,
  displayName: 'NOT',
  extendedInputs: { a: { type: numberType, description: 'Value' } },
  extendedOutputs: { result: { type: numberType, description: 'Result' } }
});
