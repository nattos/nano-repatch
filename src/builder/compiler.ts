import { AppState, GraphState, GridNode } from './state';
import { GraphDefinition, NodeInstance, Structor } from '../structor/structor';
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

      if (node.config.typeId === 'core.subgraph' || node.config.typeId === 'subgraph') {
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
          if (node.config.typeId === 'io.input' || node.config.typeId === 'input') {
            // ... (existing input logic)
            const name = node.config.name || node.id;
            flatInputs[name] = { nodeId: nodeId, port: 'val' };
          } else if (node.config.typeId === 'io.output' || node.config.typeId === 'output') {
            // ... (existing output logic)
            const name = node.config.name || node.id;
            flatOutputs[name] = { nodeId: nodeId, port: 'val' };
          }
        }

        // Process Virtual Inputs (Configured Values)
        if (node.config.values) {
          for (const [portName, value] of Object.entries(node.config.values)) {
            // Check if this port is already connected in the original graph
            const isConnected = Object.values(graph.inner.connections).some(
              c => c.toNodeId === node.id && c.toPort === portName
            );

            if (!isConnected) {
              const virtualNodeId = `${nodeId}-virtual-${portName}`;

              // Create Literal Node
              flatNodes[virtualNodeId] = {
                definitionId: 'data.literal',
                defaultConfig: value as Structor,
              };

              // Create Connection
              flatConnections.push({
                fromNode: virtualNodeId,
                fromPort: '', // Literal output is untagged/default
                toNode: nodeId,
                toPort: portName
              });
            }
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
      if (fromNode && (fromNode.config.typeId === 'core.subgraph' || fromNode.config.typeId === 'subgraph')) {
        // Connection FROM a subgraph node (output of subgraph)
        // We need to find the corresponding 'output' node inside the subgraph.
        // The port name on the subgraph node corresponds to the name of the output node.
        // So we look for an output node with name === conn.fromPort
        const subgraphId = fromNode.config.subgraphId;
        const subgraph = loadedSubgraphs.get(subgraphId);
        if (subgraph) {
          const outputNode = Object.values(subgraph.inner.nodes).find(n =>
            (n.config.typeId === 'io.output' || n.config.typeId === 'output') && (n.config.name === fromPort || n.id === fromPort)
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
      if (toNode && (toNode.config.typeId === 'core.subgraph' || toNode.config.typeId === 'subgraph')) {
        // Connection TO a subgraph node (input of subgraph)
        // We need to find the corresponding 'input' node inside the subgraph.
        const subgraphId = toNode.config.subgraphId;
        const subgraph = loadedSubgraphs.get(subgraphId);
        if (subgraph) {
          const inputNode = Object.values(subgraph.inner.nodes).find(n =>
            (n.config.typeId === 'io.input' || n.config.typeId === 'input') && (n.config.name === toPort || n.id === toPort)
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

  // 3. Cycle Detection and Breaking
  // We perform a DFS to detect back edges. Any back edge found implies a cycle.
  // We break the cycle by removing the back edge.

  const adjacency = new Map<string, Array<{ toNode: string; connIndex: number }>>();
  flatConnections.forEach((conn, index) => {
    if (!adjacency.has(conn.fromNode)) {
      adjacency.set(conn.fromNode, []);
    }
    adjacency.get(conn.fromNode)!.push({ toNode: conn.toNode, connIndex: index });
  });

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const edgesToRemove = new Set<number>();

  function detectCycles(nodeId: string) {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const neighbors = adjacency.get(nodeId);
    if (neighbors) {
      for (const { toNode, connIndex } of neighbors) {
        if (recursionStack.has(toNode)) {
          // Cycle detected!
          console.warn(`Cycle detected: ${nodeId} -> ${toNode}. Breaking connection to prevent infinite loop.`);
          edgesToRemove.add(connIndex);
        } else if (!visited.has(toNode)) {
          detectCycles(toNode);
        }
      }
    }

    recursionStack.delete(nodeId);
  }

  // Run DFS from every node (to handle disconnected components)
  for (const nodeId of Object.keys(flatNodes)) {
    if (!visited.has(nodeId)) {
      detectCycles(nodeId);
    }
  }

  // Filter out broken connections
  const validConnections = flatConnections.filter((_, index) => !edgesToRemove.has(index));

  console.log(`Compiled graph with ${Object.keys(flatNodes).length} nodes and ${validConnections.length} connections (removed ${edgesToRemove.size} cyclic connections).`);

  return {
    id: 'compiled-graph',
    kind: 'graph',
    type: { kind: 'graph', inputs: { kind: 'record', fields: {}, untagged: [] }, outputs: { kind: 'record', fields: {}, untagged: [] } }, // TODO: Compute actual type
    nodes: flatNodes,
    connections: validConnections,
    inputs: flatInputs,
    outputs: flatOutputs
  };
}