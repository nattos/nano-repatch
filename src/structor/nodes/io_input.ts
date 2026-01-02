import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory, StructorType, StructorRecord, Structor, ExecutionContext, PrimitiveNodeDefinition } from '../structor';
import { anyType } from '../std-types';

// Helper to infer type from io.input config
function inferTypeFromConfig(config: any): StructorType | undefined {
  if (!config) return undefined;
  const typeStr = config.type as string;
  if (!typeStr || typeStr === 'any') return undefined;

  if (typeStr === 'float') return { kind: 'atomic', type: 'number' };
  if (typeStr === 'string') return { kind: 'atomic', type: 'string' };
  if (typeStr.startsWith('float')) {
    const size = parseInt(typeStr.slice(5));
    if (!isNaN(size)) {
      return { kind: 'array', size, element: { kind: 'atomic', type: 'number' } };
    }
  }
  return undefined;
}

export const primitive_input: PrimitiveNodeDefinition = {
  id: 'io.input',

  kind: 'primitive',
  metadata: {
    category: NodeCategory.IO,
    keywords: ['source', 'in'],
    description: 'Graph input node.'
  },
  ui: {
    inspector: {
      fields: [
        {
          type: 'structor-type',
          label: 'Type',
          path: 'type',
          default: 'float'
        },
        { type: 'string', label: 'Name', path: 'name' }
      ]
    }
  },
  computeForwardPorts: (inputType, config, context) => {
    // Identity: Output type is same as input type of 'value' (connected) or inferred from 'type' config
    let valType = inputType.fields['value'];
    if (!valType) {
      const inferred = inferTypeFromConfig(config);
      if (inferred) {
        valType = inferred;
      }
    }

    if (!valType) valType = { kind: 'atomic', type: 'number' };
    return {
      inputs: { kind: 'record', fields: { value: { kind: 'atomic', type: 'number' } } },
      outputs: { kind: 'record', fields: { 'value': valType } }
    };
  },
  execute: (input: StructorRecord, config: any, context: ExecutionContext) => {
    const portName = config.name || 'value';
    const val = input.fields[portName] !== undefined ? input.fields[portName] : input.fields['value'];
    return { fields: { 'value': val } };
  }
};
registerNode({
  version: "1.0.0",
  ...primitive_input,
  displayName: 'Input',
  aliases: ['in', 'source'],
  extendedOutputs: {
    value: { type: anyType, description: 'The input value.', suppressInputEditor: true, suppressLabel: true }
  },
  compileConfig: (uiConfig) => ({ values: { 'value': uiConfig?.values?.['0'] } } as any)
});
