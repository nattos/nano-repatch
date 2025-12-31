import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { PrimitiveNodeDefinition, NodeCategory, FunctorType, StructorRecord, Structor, ExecutionContext, Functor } from '../structor';
import { anyType } from '../std-types';

export const primitive_apply: PrimitiveNodeDefinition = {
  id: 'functional.apply',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.Functional,
    keywords: ['call', 'invoke'],
    description: 'Applies a functor to an input value.'
  },
  computeForwardPorts: (inputType, config, context) => {
    const functorType = inputType.fields['functor'] as FunctorType;
    return {
      inputs: inputType,
      outputs: { kind: 'record', fields: { result: functorType ? functorType.output : { kind: 'atomic', type: 'any' } } }
    };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    const functor = input.fields['functor'] as Functor;
    const inputValue = input.fields['input'];
    return { fields: { result: functor(inputValue) } };
  }
};
registerNode({
  version: "1.0.0",
  ...primitive_apply,
  displayName: 'Apply Functor',
  extendedInputs: {
    functor: { type: { kind: 'functor', input: anyType, output: anyType }, description: 'The functor to apply.' },
    value: { type: anyType, description: 'The value to apply the functor to.' }
  },
  extendedOutputs: {
    result: { type: anyType, description: 'The result of the functor application.' }
  }
});
