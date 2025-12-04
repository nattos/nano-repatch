import { defineNode, registerNode } from '../../structor/node-helpers';
import { NodeCategory } from '../../structor/structor';
import { numberType } from '../../structor/std-types';

export const debugScopeNode = defineNode({
  id: 'debug.scope',
  version: '1.0.0',
  displayName: 'Scope',
  metadata: {
    category: NodeCategory.Debug,
    keywords: ['debug', 'scope', 'chart', 'visualize'],
    description: 'Visualizes input values over time.'
  },
  inputs: {
    value: { type: numberType, suppressLabel: true, alwaysShowInputEditor: true }
  },
  outputs: {
    value: numberType
  },
  config: {},
  inspectInputs: true,
  execute: (inputs) => {
    return { value: inputs.value };
  }
});

// registerNode(debugScopeNode);
