import '../customnodes/registration-worker';
import { AppState, GraphState, GridNode } from './state';
import { GraphDefinition, NodeInstance, Structor, StructorType, RecordType, AnalysisContext } from '../structor/structor';
import { NodeRepository } from '../structor/repository';
import { resolvePortName } from '../structor/primitives';

/**
 * Compiles the current AppState into a flat GraphDefinition ready for execution.
 * Recursively flattens subgraphs.
 */
export function compileGraph(
  appState: AppState,
  loadedSubgraphs: Map<string, GraphState>,
  nodeRepository: NodeRepository
): {
  graph: GraphDefinition,
  inferredTypes: Record<string, { inputs: StructorType, outputs: StructorType }>,
  virtualInputMappings: Record<string, Record<string, string>>,
  outputRemappings: Record<string, Record<string, string>>
} {
  const flatNodes: Record<string, NodeInstance> = {};
  const flatConnections: {
    fromNode: string;
    fromPort: string | number;
    toNode: string;
    toPort: string | number;
  }[] = [];
  const flatInputs: Record<string, { nodeId: string; port: string | number }> = {};
  const flatOutputs: Record<string, { nodeId: string; port: string | number }> = {};
  const virtualInputMappings: Record<string, Record<string, string>> = {};
  const outputRemappings: Record<string, Record<string, string>> = {};

  // Helper to process a graph recursively
  function processGraph(
    graph: GraphState,
    idPrefix: string,
    isRoot: boolean,
    parentConfigValues: Record<string, any> = {},
    parentSubgraphId: string | null = null,
    recursionPath: Set<string> = new Set()
  ) {
    // 1. Process Nodes
    for (const node of Object.values(graph.inner.nodes)) {
      const nodeId = idPrefix + node.id;

      if (node.config.typeId === 'core.subgraph' || node.config.typeId === 'subgraph') {
        const subgraphId = node.config.subgraphId;

        // Cycle Detection
        if (recursionPath.has(subgraphId)) {
          console.error(`Cycle detected: Subgraph ${subgraphId} includes itself (stack: ${Array.from(recursionPath).join(' -> ')}). Skipping.`);
          continue;
        }

        // Recursively process subgraph
        const subgraph = loadedSubgraphs.get(subgraphId);

        if (!subgraph) {
          console.warn(`Subgraph ${subgraphId} not found for node ${node.id}`);
          continue;
        }

        // Recurse with new prefix and updated path
        const newPath = new Set(recursionPath);
        newPath.add(subgraphId);

        // Pass node.id as parentSubgraphId (key for mapping)
        processGraph(subgraph, nodeId + '.', false, node.config.values || {}, node.id, newPath);

        // Also add the subgraph container node itself to flatNodes so it can be typed/executed (as a wrapper)
        const nodeType = nodeRepository.getNodeType(node.config.typeId);
        const instanceConfig = nodeType?.compileConfig
          ? nodeType.compileConfig(node.config)
          : (node.config as unknown as Structor);

        flatNodes[nodeId] = {
          definitionId: node.config.typeId,
          defaultConfig: instanceConfig,
        };
      } else {
        // Regular node
        const { typeId } = node.config;

        const nodeType = nodeRepository.getNodeType(typeId);
        const instanceConfig = nodeType?.compileConfig
          ? nodeType.compileConfig(node.config)
          : (node.config as unknown as Structor);

        const instance: NodeInstance = {
          definitionId: typeId,
          defaultConfig: instanceConfig,
        };

        flatNodes[nodeId] = instance;

        if (isRoot) {
          if (node.config.typeId === 'io.input' || node.config.typeId === 'input') {
            const name = node.config.name || node.id;
            flatInputs[name] = { nodeId: nodeId, port: 'value' };
          } else if (node.config.typeId === 'io.output' || node.config.typeId === 'output') {
            const name = node.config.name || node.id;
            flatOutputs[name] = { nodeId: nodeId, port: 'value' };
          }
        }

        // --- Virtual Input Propagation ---
        if (!isRoot && (node.config.typeId === 'io.input' || node.config.typeId === 'input')) {
          const inputNodes = Object.values(graph.inner.nodes)
            .filter(n => n.config.typeId === 'io.input' || n.config.typeId === 'input')
            .sort((a, b) => a.y - b.y);

          const myIndex = inputNodes.findIndex(n => n.id === node.id);
          if (myIndex !== -1) {
            const rawName = node.config.name || 'value';
            const portName = resolvePortName(rawName, myIndex, inputNodes.length, 'input');

            // 1. Static Injection (Phase 1)
            const injectedValue = parentConfigValues[portName];
            if (injectedValue !== undefined) {
              if (!instance.defaultConfig) instance.defaultConfig = { fields: {} };
              (instance.defaultConfig as any).value = injectedValue;
            }

            // 2. Dynamic Mapping (Phase 2)
            if (parentSubgraphId) {
              if (!virtualInputMappings[parentSubgraphId]) {
                virtualInputMappings[parentSubgraphId] = {};
              }
              virtualInputMappings[parentSubgraphId][portName] = nodeId;
            }
          }
        } else if (!isRoot && (node.config.typeId === 'io.output' || node.config.typeId === 'output')) {
          // New: Output Remapping for Debug Values
          if (parentSubgraphId) {
            const outputNodes = Object.values(graph.inner.nodes)
              .filter(n => n.config.typeId === 'io.output' || n.config.typeId === 'output')
              .sort((a, b) => a.y - b.y);

            const myIndex = outputNodes.findIndex(n => n.id === node.id);
            if (myIndex !== -1) {
              const rawName = node.config.name || 'value';
              const portName = resolvePortName(rawName, myIndex, outputNodes.length, 'output');

              if (!outputRemappings[parentSubgraphId]) {
                outputRemappings[parentSubgraphId] = {};
              }
              outputRemappings[parentSubgraphId][portName] = nodeId;
            }
          }
        }

        // Process Virtual Inputs (Standard)
        // ... (rest of function)
        // We need to consider both explicitly configured values AND default values for unconnected ports.

        // 1. Determine all potential input ports
        let inputPorts: { name: string, defaultValue?: any }[] = [];
        if (nodeType) {
          if (Array.isArray(nodeType.inputs)) {
            inputPorts = nodeType.inputs;
          } else if (nodeType.inputs && (nodeType.inputs as any).kind === 'record') {
            // Convert RecordType to simplified input list for virtual processing
            inputPorts = Object.entries((nodeType.inputs as any).fields || {}).map(([key, val]) => ({
              name: key,
              defaultValue: (val as any).defaultValue
            }));
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
        const subgraphId = fromNode.config.subgraphId;
        const subgraph = loadedSubgraphs.get(subgraphId);
        if (subgraph) {
          const outputNodes = Object.values(subgraph.inner.nodes)
            .filter(n => n.config.typeId === 'io.output' || n.config.typeId === 'output')
            .sort((a, b) => a.y - b.y);

          const outputNode = outputNodes.find((n, i) => {
            const rawName = (n.config as any).name || 'value';
            const portName = resolvePortName(rawName, i, outputNodes.length, 'output');
            return portName === fromPort;
          });

          if (outputNode) {
            // Rewire: Source is the 'output' node inside the subgraph
            fromNodeId = idPrefix + fromNode.id + '.' + outputNode.id;
            fromPort = 'value'; // Output nodes output on 'value' (identity)
          }
        }
      }

      // Resolve Destination
      let toNodeId = idPrefix + conn.toNodeId;
      let toPort = conn.toPort;

      const toNode = graph.inner.nodes[conn.toNodeId];
      if (toNode && (toNode.config.typeId === 'core.subgraph' || toNode.config.typeId === 'subgraph')) {
        // Connection TO a subgraph node (input of subgraph)
        const subgraphId = toNode.config.subgraphId;
        const subgraph = loadedSubgraphs.get(subgraphId);
        if (subgraph) {
          const inputNodes = Object.values(subgraph.inner.nodes)
            .filter(n => n.config.typeId === 'io.input' || n.config.typeId === 'input')
            .sort((a, b) => a.y - b.y);

          const inputNode = inputNodes.find((n, i) => {
            const rawName = (n.config as any).name || 'value';
            const portName = resolvePortName(rawName, i, inputNodes.length, 'input');
            return portName === toPort;
          });

          if (inputNode) {
            // Rewire: Destination is the 'input' node inside the subgraph
            toNodeId = idPrefix + toNode.id + '.' + inputNode.id;
            toPort = 'value'; // Input nodes receive on 'value' (identity)
          }
        }
      }

      let validSource = true;
      if (fromNode && (fromNode.config.typeId === 'core.subgraph' || fromNode.config.typeId === 'subgraph')) {
        // If fromNodeId was not updated, it means rewiring failed (port not found)
        if (fromNodeId === idPrefix + conn.fromNodeId) {
          validSource = false;
        }
      }

      let validDest = true;
      if (toNode && (toNode.config.typeId === 'core.subgraph' || toNode.config.typeId === 'subgraph')) {
        if (toNodeId === idPrefix + conn.toNodeId) {
          validDest = false;
        }
      }

      if (validSource && validDest) {
        flatConnections.push({
          fromNode: fromNodeId,
          fromPort,
          toNode: toNodeId,
          toPort
        });
      }
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

  if (executionOrder.length !== Object.keys(flatNodes).length) {
    console.warn(`Graph contains cycles! Only ${executionOrder.length}/${Object.keys(flatNodes).length} nodes differ in DAG.`);
    for (const nodeId of Object.keys(flatNodes)) {
      if (!executionOrder.includes(nodeId)) executionOrder.push(nodeId);
    }
  }

  const validConnections = flatConnections.filter((_, index) => validConnectionIndices.has(index));

  // --- Type Compilation Passes ---

  const nodeTypes = new Map<string, {
    inputs: StructorType;
    outputs: StructorType;
  }>();

  const outputRequirements = new Map<string, Record<string, StructorType>>();
  const backwardMetadata = new Map<string, any>();

  for (const nodeId of executionOrder) {
    outputRequirements.set(nodeId, {});
  }

  // --- BACKWARD PASS ---
  const context: AnalysisContext & { loadedSubgraphs: Map<string, GraphState> } = {
    repository: nodeRepository,
    broadcast: () => undefined,
    loadedSubgraphs
  };

  for (let i = executionOrder.length - 1; i >= 0; i--) {
    const nodeId = executionOrder[i];
    const instance = flatNodes[nodeId];
    const nodeDef = nodeRepository.get(instance.definitionId);

    if (nodeDef && nodeDef.kind === 'primitive') {
      const reqs = { kind: 'record', fields: outputRequirements.get(nodeId) || {} } as RecordType;
      const config = instance.defaultConfig || { fields: {} };

      let inputReqs: RecordType = {
        kind: 'record',
        fields: nodeDef.inputs ? { ...nodeDef.inputs } : {}
      };

      if (nodeDef.computeBackwardPorts) {
        try {
          const result = nodeDef.computeBackwardPorts(reqs, config, context);
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

      const inputConns = validConnections.filter(c => c.toNode === nodeId);

      for (const conn of inputConns) {
        const upstreamNodeId = conn.fromNode;
        const upstreamPort = conn.fromPort.toString();
        const downstreamPort = conn.toPort.toString();

        if (inputReqs.fields[downstreamPort]) {
          const upstreamReqs = outputRequirements.get(upstreamNodeId)!;
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
      const resolvedInputs: Record<string, StructorType> = {};

      if (nodeDef.inputs && (nodeDef.inputs as any).kind === 'record') {
        Object.assign(resolvedInputs, nodeDef.inputs.fields);
      }

      const inputConns = validConnections.filter(c => c.toNode === nodeId);
      const inputsByPort = new Map<string, StructorType[]>();

      for (const conn of inputConns) {
        const fromType = nodeTypes.get(conn.fromNode)?.outputs;
        if (fromType && fromType.kind === 'record') {
          const portName = conn.fromPort.toString();
          if (fromType.fields[portName]) {
            if (!inputsByPort.has(conn.toPort.toString())) {
              inputsByPort.set(conn.toPort.toString(), []);
            }
            inputsByPort.get(conn.toPort.toString())!.push(fromType.fields[portName]);
          }
        }
      }

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

      const config = instance.defaultConfig || { fields: {} };
      let outputRecordType: RecordType;
      let finalInputType: RecordType = inputRecordType;

      try {
        if (nodeDef.computeForwardPorts) {
          const result = nodeDef.computeForwardPorts(
            inputRecordType,
            config,
            context,
            backwardMetadata.get(nodeId)
          );
          finalInputType = result.inputs;
          outputRecordType = result.outputs;
        } else {
          outputRecordType = (nodeDef.outputs && (nodeDef.outputs as any).kind === 'record'
            ? nodeDef.outputs
            : { kind: 'record', fields: {} }) as RecordType;
        }
      } catch (e) {
        console.warn(`Failed to compute output types for node ${nodeId} (${nodeDef.id}):`, e);
        outputRecordType = { kind: 'record', fields: {} };
      }

      nodeTypes.set(nodeId, {
        inputs: finalInputType,
        outputs: outputRecordType
      });
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

  return {
    graph,
    inferredTypes,
    virtualInputMappings,
    outputRemappings
  };
}
