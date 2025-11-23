import { AppState, GraphState, GridNode } from './state';
import { GraphDefinition, NodeInstance } from '../structor/structor';
import { parseFloatOr } from '../utils/utils';
import { NodeRepository } from '../structor/repository';

/**
 * Compiles the current AppState into a flat GraphDefinition ready for execution.
 * Recursively flattens subgraphs.
 */
export function compileGraph(
  appState: AppState,
  loadedSubgraphs: Map<string, GraphState>,
  nodeRepository: NodeRepository
): GraphDefinition {
  const flatNodes: Record<string, NodeInstance> = {};
  const flatConnections: {
    fromNode: string;
    fromPort: string | number;
    toNode: string;
    toPort: string | number;
  }[] = [];
  const flatInputs: Record<string, { nodeId: string; port: string | number }> = {};
  const flatOutputs: Record<string, { nodeId: string; port: string | number }> = {};

  // Helper to process a graph recursively
  function processGraph(
    graph: GraphState,
    idPrefix: string,
    isRoot: boolean
  ) {
    // 1. Process Nodes
    for (const node of Object.values(graph.inner.nodes)) {
      const nodeId = idPrefix + node.id;

      if (node.config.typeId === 'subgraph') {
        // Recursively process subgraph
        const subgraphId = node.config.subgraphId;
        const subgraph = loadedSubgraphs.get(subgraphId);

        if (!subgraph) {
          console.warn(`Subgraph ${subgraphId} not found for node ${node.id}`);
          continue;
        }

        // Recurse with new prefix
        processGraph(subgraph, nodeId + '.', false);
      } else {
        // Regular node (or input/output node acting as identity)
        // For input/output nodes in subgraphs, they act as identity nodes
        // that pass data through.

        // Construct NodeInstance
        const { typeId } = node.config;

        const nodeType = nodeRepository.getNodeType(typeId);
        const instanceConfig = nodeType?.compileConfig
          ? nodeType.compileConfig(node.config)
          : undefined;

        const instance: NodeInstance = {
          definitionId: typeId,
          defaultConfig: instanceConfig,
        };

        flatNodes[nodeId] = instance;

        // If root, register graph inputs/outputs
        if (isRoot) {
          if (node.config.typeId === 'input') {
            // In the root graph, an 'input' node defines a graph input.
            // The port on the input node is usually '0' (output of the identity).
            // But wait, GraphDefinition.inputs maps a name to a connection *destination*.
            // Actually, GraphDefinition.inputs maps a name to { nodeId, port }.
            // This means "when graph input X is set, inject it into nodeId at port".
            // But our 'input' node is a real node in the graph.
            // So we treat 'input' nodes as the *source* of the graph input?
            // No, the executor sets inputs on the graph.
            // The 'input' node in the editor is a visualization.
            // In the compiled graph, we want the executor to inject values *into* these nodes?
            // Or maybe the 'input' node IS the injection point.
            // Let's assume the 'input' node has a special behavior or we inject into its output?
            // Actually, the standard way is: GraphDefinition.inputs maps Name -> { nodeId, port }.
            // This usually means "this internal port is connected to the outside".
            // But here we have explicit Input Nodes.
            // So, we can say: The Graph Input "Name" is connected to the "value" input of the Input Node?
            // Or better: The Input Node *is* the interface.
            // Let's stick to the primitive_input being an identity.
            // We can inject the value into the 'input' node's configuration or a special port.
            // For now, let's register it as a graph input that feeds into the 'input' node's 'value' port (if it had one).
            // Wait, primitive_input is an identity. It takes 'val' and outputs 'val'.
            // So we can map the graph input to the 'val' port of this node.
            const name = node.config.name || node.id;
            flatInputs[name] = { nodeId: nodeId, port: 'val' };
          } else if (node.config.typeId === 'output') {
            // Similarly for output.
            const name = node.config.name || node.id;
            flatOutputs[name] = { nodeId: nodeId, port: 'val' };
          }
        }
      }
    }

    // 2. Process Connections
    for (const conn of Object.values(graph.inner.connections)) {
      // Resolve Source
      let fromNodeId = idPrefix + conn.fromNodeId;
      let fromPort = conn.fromPort;

      const fromNode = graph.inner.nodes[conn.fromNodeId];
      if (fromNode && fromNode.config.typeId === 'subgraph') {
        // Connection FROM a subgraph node (output of subgraph)
        // We need to find the corresponding 'output' node inside the subgraph.
        // The port name on the subgraph node corresponds to the name of the output node.
        // So we look for an output node with name === conn.fromPort
        const subgraphId = fromNode.config.subgraphId;
        const subgraph = loadedSubgraphs.get(subgraphId);
        if (subgraph) {
          const outputNode = Object.values(subgraph.inner.nodes).find(n =>
            n.config.typeId === 'output' && (n.config.name === fromPort || n.id === fromPort)
          );
          if (outputNode) {
            // Rewire: Source is the 'output' node inside the subgraph
            fromNodeId = idPrefix + fromNode.id + '.' + outputNode.id;
            fromPort = 'val'; // Output nodes output on 'val' (identity)
          }
        }
      }

      // Resolve Destination
      let toNodeId = idPrefix + conn.toNodeId;
      let toPort = conn.toPort;

      const toNode = graph.inner.nodes[conn.toNodeId];
      if (toNode && toNode.config.typeId === 'subgraph') {
        // Connection TO a subgraph node (input of subgraph)
        // We need to find the corresponding 'input' node inside the subgraph.
        const subgraphId = toNode.config.subgraphId;
        const subgraph = loadedSubgraphs.get(subgraphId);
        if (subgraph) {
          const inputNode = Object.values(subgraph.inner.nodes).find(n =>
            n.config.typeId === 'input' && (n.config.name === toPort || n.id === toPort)
          );
          if (inputNode) {
            // Rewire: Destination is the 'input' node inside the subgraph
            toNodeId = idPrefix + toNode.id + '.' + inputNode.id;
            toPort = 'val'; // Input nodes receive on 'val' (identity)
          }
        }
      }

      flatConnections.push({
        fromNode: fromNodeId,
        fromPort,
        toNode: toNodeId,
        toPort
      });
    }
  }

  processGraph(appState.graph, '', true);

  console.log(`Compiled graph with ${Object.keys(flatNodes).length} nodes and ${flatConnections.length} connections.`);

  return {
    id: 'compiled-graph',
    kind: 'graph',
    type: { kind: 'graph', inputs: { kind: 'record', fields: {}, untagged: [] }, outputs: { kind: 'record', fields: {}, untagged: [] } }, // TODO: Compute actual type
    nodes: flatNodes,
    connections: flatConnections,
    inputs: flatInputs,
    outputs: flatOutputs
  };
}