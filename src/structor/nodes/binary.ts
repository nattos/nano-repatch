import { registerNode } from '../node-helpers';
import { defineMathNode, definePrimitiveNode } from '../type-helpers';
import { NodeCategory } from '../structor';
import { numberType } from '../std-types';

export const primitive_add = defineMathNode(
  'math.add',
  { category: NodeCategory.Math, keywords: ['sum', 'plus'], description: 'Adds a and b.' },
  (a, b) => a + b
);
registerNode({
  version: "1.0.0",
  ...primitive_add,
  displayName: 'Add',
  aliases: ['plus', 'sum'],
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Sum' }
  }
});

export const primitive_subtract = defineMathNode(
  'math.subtract',
  { category: NodeCategory.Math, keywords: ['minus', 'difference'], description: 'Subtracts b from a.' },
  (a, b) => a - b
);
registerNode({
  version: "1.0.0",
  ...primitive_subtract,
  displayName: 'Subtract',
  aliases: ['minus', 'difference'],
  extendedInputs: {
    a: { type: numberType, description: 'Minuend' },
    b: { type: numberType, description: 'Subtrahend' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Result' }
  }
});

export const primitive_multiply = defineMathNode(
  'math.multiply',
  { category: NodeCategory.Math, keywords: ['times', 'product'], description: 'Multiplies a and b.' },
  (a, b) => a * b
);
registerNode({
  version: "1.0.0",
  ...primitive_multiply,
  displayName: 'Multiply',
  aliases: ['times', 'product'],
  extendedInputs: {
    a: { type: numberType, description: 'Factor A' },
    b: { type: numberType, description: 'Factor B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Product' }
  }
});

export const primitive_divide = defineMathNode(
  'math.divide',
  { category: NodeCategory.Math, keywords: ['div', 'quotient'], description: 'Divides a by b.' },
  (a, b) => a / b
);
registerNode({
  version: "1.0.0",
  ...primitive_divide,
  displayName: 'Divide',
  aliases: ['div', 'quotient'],
  extendedInputs: {
    a: { type: numberType, description: 'Dividend' },
    b: { type: numberType, description: 'Divisor' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Quotient' }
  }
});

export const primitive_pow = defineMathNode(
  'math.pow',
  { category: NodeCategory.Math, keywords: ['power', 'exponent'], description: 'Raises a to the power of b.' },
  (a, b) => Math.pow(a, b)
);
registerNode({
  version: "1.0.0",
  ...primitive_pow,
  displayName: 'Power',
  extendedInputs: {
    a: { type: numberType, description: 'Base' },
    b: { type: numberType, description: 'Exponent' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Result' }
  }
});

export const primitive_min = defineMathNode(
  'math.min',
  { category: NodeCategory.Math, keywords: ['minimum', 'smallest'], description: 'Returns the smaller of a and b.' },
  (a, b) => Math.min(a, b)
);
registerNode({
  version: "1.0.0",
  ...primitive_min,
  displayName: 'Min',
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Minimum' }
  }
});

export const primitive_max = defineMathNode(
  'math.max',
  { category: NodeCategory.Math, keywords: ['maximum', 'largest'], description: 'Returns the larger of a and b.' },
  (a, b) => Math.max(a, b)
);
registerNode({
  version: "1.0.0",
  ...primitive_max,
  displayName: 'Max',
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Maximum' }
  }
});

export const primitive_fmod = definePrimitiveNode({
  id: 'math.fmod',
  metadata: {
    category: NodeCategory.Math,
    keywords: ['modulo', 'remainder'],
    description: 'Floating point modulo operation.'
  },
  inputs: { dividend: numberType, divisor: numberType },
  outputs: { div: numberType, mod: numberType },
  autoBroadcast: true,
  execute: (inputs, config, context) => {
    const { dividend, divisor } = inputs;
    const div = Math.floor(dividend / divisor);
    const mod = dividend % divisor;
    return { div, mod };
  }
});
registerNode({
  version: "1.0.0",
  ...primitive_fmod,
  displayName: 'FMod',
  extendedInputs: {
    dividend: { type: numberType, description: 'Dividend' },
    divisor: { type: numberType, description: 'Divisor', defaultValue: 1, range: [0, 10] }
  },
  extendedOutputs: {
    div: { type: numberType, description: 'The integer division result.' },
    mod: { type: numberType, description: 'The remainder.' }
  }
});

// Logic

export const primitive_and = defineMathNode(
  'logic.and',
  { category: NodeCategory.Logic, keywords: ['boolean', '&&'], description: 'Logical AND (1 if both non-zero, else 0).' },
  (a, b) => (a !== 0 && b !== 0) ? 1 : 0
);
registerNode({
  version: "1.0.0",
  ...primitive_and,
  displayName: 'AND',
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Result' }
  }
});

export const primitive_or = defineMathNode(
  'logic.or',
  { category: NodeCategory.Logic, keywords: ['boolean', '||'], description: 'Logical OR (1 if either non-zero, else 0).' },
  (a, b) => (a !== 0 || b !== 0) ? 1 : 0
);
registerNode({
  version: "1.0.0",
  ...primitive_or,
  displayName: 'OR',
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Result' }
  }
});

export const primitive_xor = defineMathNode(
  'logic.xor',
  { category: NodeCategory.Logic, keywords: ['boolean', '^'], description: 'Logical XOR (1 if different truthiness, else 0).' },
  (a, b) => ((a !== 0) !== (b !== 0)) ? 1 : 0
);
registerNode({
  version: "1.0.0",
  ...primitive_xor,
  displayName: 'XOR',
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Result' }
  }
});

export const primitive_equals = defineMathNode(
  'logic.equals',
  { category: NodeCategory.Logic, keywords: ['==', 'equality'], description: 'Returns 1 if a equals b, else 0.' },
  (a, b) => (a === b) ? 1 : 0
);
registerNode({
  version: "1.0.0",
  ...primitive_equals,
  displayName: 'Equals',
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Result' }
  }
});

export const primitive_greater_than = defineMathNode(
  'logic.greater_than',
  { category: NodeCategory.Logic, keywords: ['>', 'gt'], description: 'Returns 1 if a > b, else 0.' },
  (a, b) => (a > b) ? 1 : 0
);
registerNode({
  version: "1.0.0",
  ...primitive_greater_than,
  displayName: 'Greater Than',
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Result' }
  }
});

export const primitive_less_than = defineMathNode(
  'logic.less_than',
  { category: NodeCategory.Logic, keywords: ['<', 'lt'], description: 'Returns 1 if a < b, else 0.' },
  (a, b) => (a < b) ? 1 : 0
);
registerNode({
  version: "1.0.0",
  ...primitive_less_than,
  displayName: 'Less Than',
  extendedInputs: {
    a: { type: numberType, description: 'Value A' },
    b: { type: numberType, description: 'Value B' }
  },
  extendedOutputs: {
    result: { type: numberType, description: 'Result' }
  }
});
