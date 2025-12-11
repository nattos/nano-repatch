import { PortHint, defaultNodeRepository } from '../structor/repository';
import { localController, appController } from '../builder/controllers';
import { shouldShowInputEditor, getNodeVisualState, getGridSpan, NodeVisualState } from '../utils/node-width-utils';

export { shouldShowInputEditor, getNodeVisualState, getGridSpan };

// Replicate GraphNode logic to determine effective inputs/outputs
export function getEffectivePorts(node: any) {
    const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
    let inputs: PortHint[] = [];
    let outputs: PortHint[] = [];

    if (nodeType) {
        inputs = [...(nodeType.inputs || [])];
        outputs = [...(nodeType.outputs || [])];

        const inferredType = localController.observableState.inferredNodeTypes.get(node.id);

        if (inferredType && inferredType.outputs && inferredType.outputs.kind === 'record') {
            const inferredOutputs = inferredType.outputs.fields;
            if (outputs.length === 0) {
                outputs = Object.entries(inferredOutputs).map(([name, type]) => ({
                    name,
                    type,
                    description: name
                }));
            }
        }

        if (inferredType && inferredType.inputs && inferredType.inputs.kind === 'record') {
            const connectedInputs = inferredType.inputs.fields;
            const staticInputNames = new Set(inputs.map(i => i.name));

            for (const [name, type] of Object.entries(connectedInputs)) {
                if (!staticInputNames.has(name)) {
                inputs.push({
                    name,
                    type,
                    description: name
                });
                }
            }
        }
    }
    return { inputs, outputs, nodeType };
}

export function calculateNodeSpan(node: any): number {
    const { inputs, outputs, nodeType } = getEffectivePorts(node);

    // Get connected ports from AppController state
    const incomingConnections = appController.observableState.graph.auxiliary.incomingConnections.get(node.id) || [];
    const connectedPorts = new Set(incomingConnections.map(connId => {
        const conn = appController.observableState.graph.inner.connections[connId];
        return conn ? conn.toPort : null;
    }).filter(port => port !== null));

    // Check for custom body renderer (simulated check)
    // Note: We can't easily check 'this.loadedBodyRenderer' as it is component state.
    // Ideally we assume if 'nodeType.ui.body' exists, it might be custom.
    const hasCustomBody = !!(nodeType?.renderBody || nodeType?.ui?.body);

    const state = getNodeVisualState(inputs, outputs, connectedPorts as Set<string>, hasCustomBody);
    return getGridSpan(state);
}
