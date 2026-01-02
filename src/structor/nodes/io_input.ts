import { registerNode } from '../node-helpers';
import { definePrimitiveNode, toStructor, fromStructor } from '../type-helpers';
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

const inputConfigType = {
  kind: 'record',
  fields: {
    name: { kind: 'atomic', type: 'string' },
    type: anyType
  }
} as const; // Cast as const or ensure type compatibility if needed, but simple object is fine for now if structure matches RecordType

export const primitive_input: PrimitiveNodeDefinition = {
  id: 'io.input',

  kind: 'primitive',
  metadata: {
    category: NodeCategory.IO,
    keywords: ['source', 'in'],
    description: 'Graph input node.'
  },
  configType: inputConfigType as any,
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
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // We assume config is always Structural (compiled or normalized by Executor)
    // because compileConfig and configType are defined and registered.
    const fields = (config as StructorRecord)?.fields;
    const portName = (fields?.name as string) ?? 'value';
    // if (portName !== 'value' && !input.fields[portName]) {
    //   console.log(`DEBUG: io.input MISSING port '${portName}'. Has:`, Object.keys(input.fields));
    // }

    // Fallback? If fields is undefined, it means config was raw and uncompiled/unnormalized.
    // This shouldn't happen in standard flow. If it does, we default to 'value'.

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
  compileConfig: (config) => {
    const structor = toStructor(config, inputConfigType as any);
    // Preserve virtual inputs which are not part of the strict schema but used by executor
    if ((config as any).values) {
      (structor as any).values = (config as any).values;
    }
    return structor;
  }
});
