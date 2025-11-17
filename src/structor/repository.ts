import { NodeDefinition } from './structor';
import { primitive_add, primitive_clamp, make_literal_primitive, primitive_apply } from './primitives';

export interface NodeType {
    id: string;
    version: string;
    displayName: string;
    definition: NodeDefinition;
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
    definition: primitive_add
});

defaultNodeRepository.register({
    id: 'clamp',
    version: '1.0.0',
    displayName: 'Clamp',
    definition: primitive_clamp
});

defaultNodeRepository.register({
    id: 'apply',
    version: '1.0.0',
    displayName: 'Apply Functor',
    definition: primitive_apply
});

defaultNodeRepository.register({
    id: 'literal_5',
    version: '1.0.0',
    displayName: 'Constant 5',
    definition: make_literal_primitive(5, { kind: 'atomic', type: 'number' })
});

defaultNodeRepository.register({
    id: 'literal_10',
    version: '1.0.0',
    displayName: 'Constant 10',
    definition: make_literal_primitive(10, { kind: 'atomic', type: 'number' })
});