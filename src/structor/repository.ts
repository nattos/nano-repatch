import { NodeDefinition, StructorType } from './structor';
import { primitive_add, primitive_clamp, primitive_literal, primitive_apply } from './primitives';

export const NumberType: StructorType = { kind: 'atomic', type: 'number' };
export const AnyType: StructorType = { kind: 'atomic', type: 'any' };

export interface PortHint {
    name: string; // Corresponds to tag. Empty string for default/untagged.
    type: StructorType;
    description?: string;
    // For "virtual inputs"
    defaultValue?: any;
    range?: [number, number];
}

export interface NodeType {
    id: string;
    version: string;
    displayName: string;
    definition: NodeDefinition;
    inputs?: PortHint[];
    outputs?: PortHint[];
}

export class NodeRepository {
    private nodes = new Map<string, NodeType>();

    register(node: NodeType): void {
        this.nodes.set(node.id, node);
    }

    get(id: string): NodeDefinition | undefined {
        return this.nodes.get(id)?.definition;
    }

    getNodeType(id: string): NodeType | undefined {
        return this.nodes.get(id);
    }
}

export const defaultNodeRepository = new NodeRepository();

defaultNodeRepository.register({
    id: 'add',
    version: '1.0.0',
    displayName: 'Add',
    definition: primitive_add,
    inputs: [
        { name: '', type: NumberType, description: 'Value to add. Can receive multiple connections.' }
    ],
    outputs: [
        { name: '0', type: NumberType, description: 'The sum of all inputs.' }
    ]
});

defaultNodeRepository.register({
    id: 'clamp',
    version: '1.0.0',
    displayName: 'Clamp',
    definition: primitive_clamp,
    inputs: [
        { name: '', type: NumberType, description: 'Value to clamp. Can receive multiple connections.' },
        { name: 'min', type: NumberType, description: 'Minimum value.', defaultValue: 0, range: [0, 1] },
        { name: 'max', type: NumberType, description: 'Maximum value.', defaultValue: 1, range: [0, 1] }
    ],
    outputs: [
        { name: '0', type: NumberType, description: 'The clamped value.' }
    ]
});

defaultNodeRepository.register({
    id: 'apply',
    version: '1.0.0',
    displayName: 'Apply Functor',
    definition: primitive_apply,
    inputs: [
        { name: 'functor', type: { kind: 'functor', input: AnyType, output: AnyType }, description: 'The functor to apply.' },
        { name: 'value', type: AnyType, description: 'The value to apply the functor to.' }
    ],
    outputs: [
        { name: '0', type: AnyType, description: 'The result of the functor application.' }
    ]
});

defaultNodeRepository.register({
    id: 'literal',
    version: '1.0.0',
    displayName: 'Literal',
    definition: primitive_literal,
    outputs: [
        { name: '0', type: AnyType, description: 'The literal value.' }
    ]
});