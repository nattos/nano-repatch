import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory, StructorRecord, Structor, ExecutionContext, PrimitiveNodeDefinition } from '../structor';
import { anyType } from '../std-types';

export const primitive_output: PrimitiveNodeDefinition = {
  id: 'io.output',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.IO,
    keywords: ['sink', 'out'],
    description: 'Graph output node.'
  },
  computeForwardPorts: (inputType, config, context) => {
    // Identity: Output type is same as input type of 'val'
    const valType = inputType.fields['value'] || { kind: 'atomic', type: 'any' };
    return {
      inputs: { kind: 'record', fields: { value: valType } },
      outputs: { kind: 'record', fields: { 'value': valType } }
    };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Identity: Output value is input 'val'
    const val = input.fields['value'];
    return { fields: { 'value': val } };
  }
};
registerNode({
  version: "1.0.0",
  ...primitive_output,
  displayName: 'Output',
  aliases: ['out', 'sink'],
  extendedInputs: {
    value: { type: anyType, description: 'The output value.', suppressInputEditor: true, suppressLabel: true }
  },
  extendedOutputs: {
    value: { type: anyType, description: 'The graph output value.', suppressInputEditor: true, suppressLabel: true }
  }
});
