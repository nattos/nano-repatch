import '../customnodes/registration-worker';
import { AppState, GraphState, GridNode } from './state';
import { GraphDefinition, NodeInstance, Structor, StructorType, RecordType, AnalysisContext } from '../structor/structor';
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
          : (node.config as unknown as Structor); // Fallback to raw config

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
          inputPorts = nodeType.inputs || [];
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
    inputs: StructorType; // RecordType
    outputs: StructorType; // RecordType
  }>();

  // Requirements map: NodeId -> PortName -> Required Type
  // This accumulates what downstream nodes WANT from this node's outputs.
  const outputRequirements = new Map<string, Record<string, StructorType>>();
  const backwardMetadata = new Map<string, any>();

  // Initialize output requirements maps
  for (const nodeId of executionOrder) {
    outputRequirements.set(nodeId, {});
  }

  // --- BACKWARD PASS ---
  // Propagate requirements from outputs to inputs (upstream)
  const context: AnalysisContext & { loadedSubgraphs: Map<string, GraphState> } = {
    repository: nodeRepository,
    broadcast: () => undefined,
    loadedSubgraphs
  };

  // Iterate in REVERSE execution order (from Sinks to Sources)
  for (let i = executionOrder.length - 1; i >= 0; i--) {
    const nodeId = executionOrder[i];
    const instance = flatNodes[nodeId];
    const nodeDef = nodeRepository.get(instance.definitionId);

    if (nodeDef && nodeDef.kind === 'primitive') {
      const reqs = { kind: 'record', fields: outputRequirements.get(nodeId) || {} } as RecordType;
      const config = instance.defaultConfig || { fields: {} }; // Wrapped in 'fields' usually? structor is Structor value.
      // Actually defaultConfig is likely just a JS object (Structor).
      // Let's assume it matches the shape.

      // 1. Compute Input Requirements
      // Start with static input definitions as baseline requirements
      let inputReqs: RecordType = {
        kind: 'record',
        fields: nodeDef.inputs ? { ...nodeDef.inputs } : {}
      };

      if (nodeDef.computeBackwardPorts) {
        try {
          // Pass the baseline requirements to the function?
          // Or just let it return its own and merge?
          // The interface implies it calculates them based on outputs.
          // Let's merge.
          const result = nodeDef.computeBackwardPorts(reqs, config, context);
          // Merge/Override static inputs with dynamic requirements
          inputReqs = {
            kind: 'record',
            fields: { ...inputReqs.fields, ...result.inputRequirements.fields }
          };

          if (result.backwardMetadata) {
            backwardMetadata.set(nodeId, result.backwardMetadata);
          }
        } catch (e) {
          console.warn(`Backward pass failed for ${nodeId} (${nodeDef.id}):`, e);
        }
      }

      // 2. Propagate Input Requirements to Upstream Nodes
      // Find connections providing input to this node
      const inputConns = validConnections.filter(c => c.toNode === nodeId);

      for (const conn of inputConns) {
        const upstreamNodeId = conn.fromNode;
        const upstreamPort = conn.fromPort.toString();
        const downstreamPort = conn.toPort.toString();

        if (inputReqs.fields[downstreamPort]) {
          // The node says: "I need Type T on input 'downstreamPort'"
          // So we tell the upstream node: "Your output 'upstreamPort' is required to be Type T"
          const upstreamReqs = outputRequirements.get(upstreamNodeId)!;
          // If multiple nodes require different types, we might need to Union/Merge.
          // For now, Last Write Wins or simple override.
          upstreamReqs[upstreamPort] = inputReqs.fields[downstreamPort];
        }
      }
    }
  }


  // --- FORWARD PASS ---
  for (const nodeId of executionOrder) {
    const instance = flatNodes[nodeId];
    const nodeDef = nodeRepository.get(instance.definitionId);

    if (nodeDef && nodeDef.kind === 'primitive') {
      // 1. Gather Input Types from Upstream
      const resolvedInputs: Record<string, StructorType> = {};

      // Initialize with statically defined inputs (to prevent port loss for unconnected ports)
      if (nodeDef.inputs) {
        Object.assign(resolvedInputs, nodeDef.inputs);
      }

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
      const expectedInputs = nodeDef.inputs || {};

      for (const [port, types] of inputsByPort) {
        const expected = expectedInputs[port];
        if (expected && expected.kind === 'array') {
          if (types.length > 0) {
            resolvedInputs[port] = { kind: 'array', element: types[0], size: types.length };
          }
        } else {
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
      let finalInputType: RecordType = inputRecordType;

      try {
        if (nodeDef.computeForwardPorts) {
          const result = nodeDef.computeForwardPorts(
            inputRecordType,
            config, // Pass actual config value
            context,
            backwardMetadata.get(nodeId)
          );
          finalInputType = result.inputs;
          outputRecordType = result.outputs;
        } else {
          outputRecordType = { kind: 'record', fields: {} };
        }
      } catch (e) {
        console.warn(`Failed to compute output types for node ${nodeId} (${nodeDef.id}):`, e);
        outputRecordType = { kind: 'record', fields: {} };
      }

      nodeTypes.set(nodeId, {
        inputs: finalInputType,
        outputs: outputRecordType
      });

      // Broadcast logic...
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