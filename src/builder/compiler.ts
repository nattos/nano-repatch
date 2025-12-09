import '../customnodes/debug/nodes-registration';
import '../customnodes/expr/nodes';
import '../customnodes/osc/nodes';
import '../customnodes/nicepattern/nodes';
import '../customnodes/resolume/nodes';
import '../customnodes/curve/nodes';
import '../customnodes/midi/nodes';
import { AppState, GraphState, GridNode } from './state';
import { GraphDefinition, NodeInstance, Structor, StructorType, RecordType } from '../structor/structor';
import { NodeRepository } from '../structor/repository';

/**
 * Compiles the current AppState into a flat GraphDefinition ready for execution.
 * Recursively flattens subgraphs.
 */
export function compileGraph(
  appState: AppState,
  loadedSubgraphs: Map<string, GraphState>,
  nodeRepository: NodeRepository
): { graph: GraphDefinition, inferredTypes: Record<string, { inputs: StructorType, outputs: StructorType }> } {
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

        // Process Virtual Inputs (Configured Values & Defaults)
        // We need to consider both explicitly configured values AND default values for unconnected ports.

        // 1. Determine all potential input ports
        let inputPorts: { name: string, defaultValue?: any }[] = [];
        if (nodeType) {
          if (nodeType.compilePorts) {
            // Pass the compiled config (instanceConfig) to compilePorts
            const ports = nodeType.compilePorts(node, { loadedSubgraphs, compiledConfig: instanceConfig });
            if (ports) inputPorts = ports.inputs;
          } else {
            inputPorts = nodeType.inputs || [];
          }
        }

        // 2. Collect all port names to process (defined inputs + any extra keys in config.values)
        const portsToProcess = new Set<string>(inputPorts.map(p => p.name));
        if (node.config.values) {
          Object.keys(node.config.values).forEach(k => portsToProcess.add(k));
        }

        for (const portName of portsToProcess) {
          // Check if this port is already connected in the original graph
          const isConnected = Object.values(graph.inner.connections).some(
            c => c.toNodeId === node.id && c.toPort === portName
          );

          if (!isConnected) {
            // Determine value: Config > Default > undefined
            let value = node.config.values?.[portName];

            if (value === undefined) {
              const portDef = inputPorts.find(p => p.name === portName);
              if (portDef && portDef.defaultValue !== undefined) {
                value = portDef.defaultValue;
              } else if (portDef && (portDef as any).type && ((portDef as any).type as any).defaultValue !== undefined) {
                value = ((portDef as any).type as any).defaultValue;
              } else {
                 // console.log(`No value for ${portName} in ${node.id} (type: ${node.config.typeId}). Def:`, portDef);
              }
            }

            if (value !== undefined) {
              // Inject into defaultConfig.values so GraphExecutor can pick it up dynamically
              if (!instance.defaultConfig) instance.defaultConfig = { fields: {} };
              if (!(instance.defaultConfig as any).values) (instance.defaultConfig as any).values = {};
              (instance.defaultConfig as any).values[portName] = value;
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

  // 3. Cycle Detection and Breaking (and Topological Sort)
  const adjacency = new Map<string, Array<{ toNode: string; connIndex: number }>>();
  const inDegree = new Map<string, number>();

  // Initialize in-degrees
  Object.keys(flatNodes).forEach(nodeId => inDegree.set(nodeId, 0));

  flatConnections.forEach((conn, index) => {
    if (!adjacency.has(conn.fromNode)) {
      adjacency.set(conn.fromNode, []);
    }
    adjacency.get(conn.fromNode)!.push({ toNode: conn.toNode, connIndex: index });
    inDegree.set(conn.toNode, (inDegree.get(conn.toNode) || 0) + 1);
  });

  // Kahn's Algorithm for Topological Sort & Cycle Breaking
  const executionOrder: string[] = [];
  const queue: string[] = [];
  const validConnectionIndices = new Set<number>();

  // Start with nodes having in-degree 0
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    executionOrder.push(u);

    if (adjacency.has(u)) {
      for (const { toNode, connIndex } of adjacency.get(u)!) {
         validConnectionIndices.add(connIndex);
         inDegree.set(toNode, (inDegree.get(toNode) || 0) - 1);
         if (inDegree.get(toNode) === 0) {
           queue.push(toNode);
         }
      }
    }
  }

  // If there are still nodes with in-degree > 0, we have cycles (or just unvisited nodes in a cycle)
  // For now, we just exclude connections that form the cycle implicitly by only keeping validConnectionIndices.
  // Although, strictly speaking, we might want to be more aggressive about breaking specific backedges.
  // But this simple approach ensures we have a valid DAG execution order.

  // Any nodes NOT in executionOrder are part of a cycle or dependent on a cycle.
  // We should probably include them in the result but disconnected?
  // Or just warn.
  if (executionOrder.length !== Object.keys(flatNodes).length) {
     console.warn(`Graph contains cycles! Only ${executionOrder.length}/${Object.keys(flatNodes).length} nodes differ in DAG.`);
     // Add remaining nodes to execution order arbitrarily to ensure they exist in the map
      for (const nodeId of Object.keys(flatNodes)) {
        if (!executionOrder.includes(nodeId)) executionOrder.push(nodeId);
      }
  }

  const validConnections = flatConnections.filter((_, index) => validConnectionIndices.has(index));

  // --- Type Compilation Passes ---

  // Initialize Type State
  const nodeTypes = new Map<string, {
    inputs: StructorType; // RecordType theoretically
    outputs: StructorType; // RecordType
  }>();

  // Backward Pass (Constraint Propagation could go here)
  // For now, we assume explicit types from Node Definitions.

  // Forward Pass (Type Inference)
  for (const nodeId of executionOrder) {
    const instance = flatNodes[nodeId];
    const nodeDef = nodeRepository.get(instance.definitionId);

    if (nodeDef && nodeDef.kind === 'primitive') {
        // 1. Gather Input Types from Upstream
        const resolvedInputs: Record<string, StructorType> = {};

        // Find connections to this node
        const inputConns = validConnections.filter(c => c.toNode === nodeId);

        // Group by input port (to handle arrays)
        const inputsByPort = new Map<string, StructorType[]>();
        for (const conn of inputConns) {
            const fromType = nodeTypes.get(conn.fromNode)?.outputs;
            if (fromType && fromType.kind === 'record') {
                 // Resolve source type
                 const portName = conn.fromPort.toString(); // TODO: number ports
                 if (fromType.fields[portName]) {
                     if (!inputsByPort.has(conn.toPort.toString())) {
                         inputsByPort.set(conn.toPort.toString(), []);
                     }
                     inputsByPort.get(conn.toPort.toString())!.push(fromType.fields[portName]);
                 }
            }
        }

        // Resolve final input types (handling arrays vs single)
        // We need the Node Definition's Input Schema to know if it EXPECTS an array.
        // If it expects an array, we collect all connections.
        // If it expects a scalar, we take the last one (or first).

        const expectedInputs = nodeDef.inputs || {};

        for (const [port, types] of inputsByPort) {
             const expected = expectedInputs[port];
             if (expected && expected.kind === 'array') {
                 // It's an array input, so we effectively have an array of the connected types.
                 // We need to Union them or assume they are homogeneous?
                 // For now, let's assume valid types.
                 // The "Type" of the input port is now an Array of the connected types.
                 // Wait, structor type system doesn't have Union types yet.
                 // Let's take the first one as representative for the element type?
                 if (types.length > 0) {
                   resolvedInputs[port] = { kind: 'array', element: types[0], size: types.length };
                 }
             } else {
                 // Scalar - take last
                 if (types.length > 0) {
                     resolvedInputs[port] = types[types.length - 1];
                 }
             }
        }

        const inputRecordType: RecordType = {
            kind: 'record',
            fields: resolvedInputs
        };

        // 2. Compute Output Types
        const config = instance.defaultConfig || { fields: {} };
        // Valid config type placeholder for now
        const configType: RecordType = { kind: 'record', fields: {} };

        let outputRecordType: RecordType;
        try {
             outputRecordType = nodeDef.computeOutputTypes(
                inputRecordType,
                configType,
                { repository: nodeRepository, broadcast: () => undefined } as any
            );
        } catch (e) {
            console.warn(`Failed to compute output types for node ${nodeId} (${nodeDef.id}):`, e);
            outputRecordType = { kind: 'record', fields: {} };
        }

        nodeTypes.set(nodeId, {
            inputs: inputRecordType,
            outputs: outputRecordType
        });

        // 3. Compute Broadcast Config (if applicable)
        // We only do this for primitive nodes that request autoBroadcast (or use typed helper)
        if (nodeDef.metadata?.keywords?.includes('broadcast')) {
             // ... Logic to generate broadcast op ...
             // For now, we rely on the executor doing it dynamically if we don't store it.
             // But the plan says: "The compiler will take the config, and produce a broadcast operation"
        }
    }
  }

  // Convert nodeTypes to plain object for worker transfer
  const inferredTypes: Record<string, { inputs: StructorType, outputs: StructorType }> = {};
  for (const [id, types] of nodeTypes) {
      inferredTypes[id] = types;
  }

  const graph: GraphDefinition = {
    id: 'compiled-graph',
    kind: 'graph',
    type: { kind: 'graph', inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: {} } },
    nodes: flatNodes,
    connections: validConnections,
    inputs: flatInputs,
    outputs: flatOutputs,
    executionOrder
  };

  return { graph, inferredTypes };
}