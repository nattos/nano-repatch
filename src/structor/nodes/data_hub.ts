import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory } from '../structor';
import { anyType, numberType } from '../std-types';

export const primitive_hub = definePrimitiveNode({
  id: 'util.hub',
  metadata: { category: NodeCategory.Utility, keywords: ['hub', 'reroute'], description: 'Passes input to output.' },
  inputs: { value: anyType },
  outputs: { value: anyType },
  autoBroadcast: true,
  execute: (inputs) => ({ value: inputs.value })
});
registerNode({
  version: "1.0.0",
  ...primitive_hub,
  displayName: 'Hub',
  extendedInputs: {
    value: { type: anyType, description: 'Input', suppressInputEditor: true, suppressLabel: true }
  },
  extendedOutputs: {
    value: { type: anyType, description: 'Output', suppressLabel: true }
  }
});

export const primitive_float = definePrimitiveNode({
  id: 'data.float',
  metadata: { category: NodeCategory.Data, keywords: ['float', 'number', 'slider'], description: 'Float value with slider.' },
  inputs: { value: numberType },
  outputs: { value: numberType },
  autoBroadcast: true,
  execute: (inputs) => ({ value: inputs.value })
});
registerNode({
  version: "1.0.0",
  ...primitive_float,
  displayName: 'Float',
  extendedInputs: {
    value: { type: numberType, description: 'Value', defaultValue: 0 }
  },
  extendedOutputs: {
    value: { type: numberType, description: 'Value' }
  },
  compileConfig: (uiConfig) => ({ values: { value: uiConfig.value ?? 0.0 }, fields: {}, untagged: [] })
});
