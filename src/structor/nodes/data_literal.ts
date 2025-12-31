import { registerNode } from '../node-helpers';
import { PrimitiveNodeDefinition, NodeCategory, StructorType, StructorRecord, Structor, ExecutionContext } from '../structor';
import { anyType, numberType } from '../std-types';

// Helper to infer type from value (simple version)
function inferType(value: any): StructorType {
  if (typeof value === 'number') return numberType;
  if (typeof value === 'string') return { kind: 'atomic', type: 'string' };
  if (typeof value === 'boolean') return { kind: 'atomic', type: 'boolean' };
  if (Array.isArray(value)) {
    const elType = value.length > 0 ? inferType(value[0]) : anyType;
    return { kind: 'array', element: elType, size: value.length };
  }
  if (typeof value === 'object' && value !== null) {
    return anyType;
  }
  return anyType;
}

export const primitive_literal: PrimitiveNodeDefinition = {
  id: 'data.literal',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.Data,
    keywords: ['value', 'constant'],
    description: 'Outputs a constant value.'
  },
  configType: { kind: 'atomic', type: 'any' }, // This literal can hold any type of value
  computeForwardPorts: (inputType, config, context) => {
    return {
      inputs: { kind: 'record', fields: {} },
      outputs: { kind: 'record', fields: { value: inferType(config) } }
    };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    return { fields: { value: config } };
  },
};
registerNode({
  version: "1.0.0",
  ...primitive_literal,
  displayName: 'Literal',
  extendedOutputs: {
    value: { type: anyType, description: 'The literal value.' } // Repository uses empty name? lines 611: { name: '', ... }
    // NOTE: If name is '', then port creation might be weird if definePrimitiveNode uses 'value'.
    // Step 3042 line 611 says name: ''.
    // `computeForwardPorts` returns `fields: { value: ... }`.
    // If I register with extendedOutput name='', it might override.
    // However, `execute` returns `value`.
    // If name is empty string, does executor handle it?
    // I'll stick to 'value' as the key is 'value'. The `name` property in `extendedOutputs` (PortHint) is what's used for ID if not map.
    // Wait, PortHint `name` IS the ID.
    // If repository used '', then the logic was likely using index 0?
    // But `execute` returns key 'value'.
    // `primitive_literal` in `primitives.ts` has `return { fields: { value: config } }`.
    // So the port logic expects 'value'.
    // Repository line 611 `name: ''` might be a UI thing or legacy.
    // I will use `value` to be safe and consistent with code.
  },
  compileConfig: (uiConfig) => uiConfig?.literal?.value ?? 0.0
});
