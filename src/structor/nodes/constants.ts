import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory } from '../structor';
import { numberType } from '../std-types';

export const primitive_pi = definePrimitiveNode({
  id: 'math.pi',
  metadata: { category: NodeCategory.Math, keywords: ['pi', 'constant'], description: 'Returns the value of Pi.' },
  inputs: {},
  outputs: { result: numberType },
  execute: () => ({ result: Math.PI })
});
registerNode({ version: "1.0.0",
  ...primitive_pi,
  displayName: 'Pi',
  extendedOutputs: { result: { type: numberType, description: 'Pi' } }
});

export const primitive_e = definePrimitiveNode({
  id: 'math.e',
  metadata: { category: NodeCategory.Math, keywords: ['e', 'euler', 'constant'], description: 'Returns the value of Euler\'s number.' },
  inputs: {},
  outputs: { result: numberType },
  execute: () => ({ result: Math.E })
});
registerNode({ version: "1.0.0",
  ...primitive_e,
  displayName: 'E',
  extendedOutputs: { result: { type: numberType, description: 'Euler\'s Number' } }
});
