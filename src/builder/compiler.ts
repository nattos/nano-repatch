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
    // Removed isRoot, as implicit grouping should work in nested graphs too.
    parentConfigValues: Record<string, any> = {},
    parentSubgraphId: string | null = null,
    recursionPath: Set<string> = new Set(),
    executionTag: string | undefined = undefined,
    executionOwnerId: string | undefined = undefined
  ) {
    // 0. Local Pre-calculation: Identify Parent-Child Relationships in THIS graph scope
    const childToParent = new Map<string, string>();
    const parentNodes = new Set<string>();

    for (const node of Object.values(graph.inner.nodes)) {
      const nodeType = nodeRepository.getNodeType(node.config.typeId);
      if (nodeType && nodeType.definition.getChildren) {
        const children = nodeType.definition.getChildren(node, graph.inner.nodes);
        for (const childId of children) {
          if (childToParent.has(childId)) {
            console.warn(`Node ${childId} is owned by multiple parents! Keeping ${childToParent.get(childId)}, ignoring ${node.id}.`);
            continue;
          }
          childToParent.set(childId, node.id);
        }
        if (children.length > 0) {
          parentNodes.add(node.id);
        }
      }
    }

    // 1. Process Nodes
    for (const node of Object.values(graph.inner.nodes)) {
      // Skip if this node is implicitly owned by another node in the SAME graph level
      if (childToParent.has(node.id)) {
        continue;
      }

      const nodeId = idPrefix + node.id;
      const nodeType = nodeRepository.getNodeType(node.config.typeId);

      // Check for subgraph expansion
      // Explicit Subgraph (External File) vs Implicit Subgraph (Embedded Children)
      // We prioritize Implicit if the node definition supports `getChildren`.

      if (nodeType && nodeType.definition.getChildren) {
        // IMPLICIT PARENT NODE (e.g. core.ifthen)

        const childrenIds = nodeType.definition.getChildren(node, graph.inner.nodes);

        if (childrenIds.length > 0) {
          // 2. Construct Transient Graph for children
          const transientGraph: GraphState = {
            inner: {
              nodes: {},
              connections: {}
            },
            auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
          } as any;

          const childSet = new Set(childrenIds);

          // Copy nodes to transient graph
          childrenIds.forEach(cid => {
            transientGraph.inner.nodes[cid] = graph.inner.nodes[cid];
          });

          // Copy/Filter connections
          Object.values(graph.inner.connections).forEach(conn => {
            if (childSet.has(conn.fromNodeId) && childSet.has(conn.toNodeId)) {
              transientGraph.inner.connections[conn.id] = conn;
            }
          });

          // 3. Define Context
          const implicitTag = (nodeType?.definition as any)?.subgraphExpansionTag;

          let nextExecutionTag = executionTag;
          let nextOwnerId = executionOwnerId;

          if (implicitTag && implicitTag !== 'inline') {
            nextExecutionTag = implicitTag;
            nextOwnerId = nodeId;
          }

          // 4. Recurse
          processGraph(transientGraph, nodeId + '.', node.config.values || {}, node.id, recursionPath, nextExecutionTag, nextOwnerId);
        }

        // 5. Add Parent Node itself
        const instanceConfig = nodeType?.compileConfig
          ? nodeType.compileConfig(node.config)
          : (node.config as unknown as Structor);

        flatNodes[nodeId] = {
          definitionId: node.config.typeId,
          defaultConfig: instanceConfig,
          executionTag: executionTag,
          executionOwnerId: executionOwnerId
        };
      } else if (nodeType?.definition.subgraphExpansionTag) {
        // EXPLICIT SUBGRAPH (Inline or Conditional)
        // Only enter this if it wasn't handled as implicit parent.
        const subgraphTag = nodeType.definition.subgraphExpansionTag;
        // It's a subgraph expander (inline or conditional)
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

        // Determine execution context for children
        let nextExecutionTag = executionTag;
        let nextOwnerId = executionOwnerId;

        if (subgraphTag !== 'inline') {
          nextExecutionTag = subgraphTag;
          nextOwnerId = nodeId;
        }

        // Recurse with new prefix and updated path
        const newPath = new Set(recursionPath);
        newPath.add(subgraphId);

        processGraph(subgraph, nodeId + '.', node.config.values || {}, node.id, newPath, nextExecutionTag, nextOwnerId);

        // Also add the subgraph container node itself to flatNodes
        const instanceConfig = nodeType?.compileConfig
          ? nodeType.compileConfig(node.config)
          : (node.config as unknown as Structor);

        flatNodes[nodeId] = {
          definitionId: node.config.typeId,
          defaultConfig: instanceConfig,
          executionTag: executionTag,
          executionOwnerId: executionOwnerId
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
          executionTag,
          executionOwnerId
        };

        flatNodes[nodeId] = instance;

        if (idPrefix === '') { // Top level
          if (node.config.typeId === 'io.input' || node.config.typeId === 'input') {
            const name = node.config.name || node.id;
            flatInputs[name] = { nodeId: nodeId, port: 'value' };
          } else if (node.config.typeId === 'io.output' || node.config.typeId === 'output') {
            const name = node.config.name || node.id;
            flatOutputs[name] = { nodeId: nodeId, port: 'value' };
          }
        }

        // --- Virtual Input Propagation ---
        if (idPrefix !== '' && (node.config.typeId === 'io.input' || node.config.typeId === 'input')) {
          const inputNodes = Object.values(graph.inner.nodes)
            .filter(n => n.config.typeId === 'io.input' || n.config.typeId === 'input')
            .sort((a, b) => a.y - b.y);

          const myIndex = inputNodes.findIndex(n => n.id === node.id);
          if (myIndex !== -1) {
            const rawName = node.config.name || 'value';
            const portName = resolvePortName(rawName, myIndex, inputNodes.length, 'input');

            // 1. Static Injection (Phase 1)
            const injectedValue = parentConfigValues[portName];

            if (!instance.defaultConfig) instance.defaultConfig = { fields: {} };

            if (injectedValue !== undefined) {
              if (!(instance.defaultConfig as any).values) (instance.defaultConfig as any).values = {};
              (instance.defaultConfig as any).values[portName] = injectedValue;
            }

            // Ensure the inner node knows its resolved name (e.g. replacing '#' with 'in')
            if ((instance.defaultConfig as any).fields) {
              (instance.defaultConfig as any).fields.name = portName;
            } else {
              (instance.defaultConfig as any).name = portName;
            }

            // Ensure the port is in 'values' so Executor scans it for connections
            if (!(instance.defaultConfig as any).values) (instance.defaultConfig as any).values = {};
            if (!Object.prototype.hasOwnProperty.call((instance.defaultConfig as any).values, portName)) {
              (instance.defaultConfig as any).values[portName] = undefined;
            }

            // 2. Dynamic Mapping (Phase 2)
            if (parentSubgraphId) {
              if (!virtualInputMappings[parentSubgraphId]) {
                virtualInputMappings[parentSubgraphId] = {};
              }
              virtualInputMappings[parentSubgraphId][portName] = nodeId;
            }
          }
        }

        if (idPrefix !== '' && (node.config.typeId === 'io.output' || node.config.typeId === 'output')) {
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
      let baseFromNodeId = idPrefix + conn.fromNodeId;
      if (childToParent.has(conn.fromNodeId)) {
        baseFromNodeId = idPrefix + childToParent.get(conn.fromNodeId)! + '.' + conn.fromNodeId;
      }
      let fromNodeId = baseFromNodeId;
      let fromPort = conn.fromPort;

      const fromNode = graph.inner.nodes[conn.fromNodeId];
      // Check if fromNode is a subgraph expander
      const fromNodeType = fromNode ? nodeRepository.getNodeType(fromNode.config.typeId) : undefined;
      const fromIsSubgraph = (fromNodeType?.definition as any)?.subgraphExpansionTag;

      if (fromNode && fromIsSubgraph) {
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
            fromNodeId = baseFromNodeId + '.' + outputNode.id;
            fromPort = 'value'; // Output nodes output on 'value' (identity)
          }
        }
      }

      // Resolve Destination
      let baseToNodeId = idPrefix + conn.toNodeId;
      if (childToParent.has(conn.toNodeId)) {
        baseToNodeId = idPrefix + childToParent.get(conn.toNodeId)! + '.' + conn.toNodeId;
      }
      let toNodeId = baseToNodeId;
      let toPort = conn.toPort;

      const toNode = graph.inner.nodes[conn.toNodeId];
      // Check if toNode is a subgraph expander
      const toNodeType = toNode ? nodeRepository.getNodeType(toNode.config.typeId) : undefined;
      const toIsSubgraph = (toNodeType?.definition as any)?.subgraphExpansionTag;

      if (toNode && toIsSubgraph) {
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
            toNodeId = baseToNodeId + '.' + inputNode.id;
            // Use the named port (resolved) to match Virtual Input injection keys.
            toPort = toPort;
          }
        }
      }

      let validSource = true;
      if (fromNode && fromIsSubgraph) {
        // If tag == 'inline', strict rewiring?
        if (fromIsSubgraph === 'inline' && fromNodeId === baseFromNodeId) {
          validSource = false;
        }
      }

      let validDest = true;
      if (toNode && toIsSubgraph) {
        if (toIsSubgraph === 'inline' && toNodeId === baseToNodeId) {
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

        // Implicit Dependency Injection for Non-Inline Subgraphs

        // Case 0: Implicit Child -> Destination (Parent -> Destination)
        if (childToParent.has(conn.fromNodeId)) {
          const parentId = idPrefix + childToParent.get(conn.fromNodeId)!;
          if (parentId !== toNodeId) {
            flatConnections.push({
              fromNode: parentId,
              fromPort: '___control___',
              toNode: toNodeId,
              toPort: '___control___'
            });
          }
        }

        // Case 1: Subgraph Output (Wrapper -> Peer via Inner)
        if (fromIsSubgraph && fromIsSubgraph !== 'inline') {
          const wrapperId = baseFromNodeId;
          // If rewired (targeting inner node), add dependency Wrapper -> Destination
          if (fromNodeId !== wrapperId) {
            flatConnections.push({
              fromNode: wrapperId,
              fromPort: '___control___',
              toNode: toNodeId,
              toPort: '___control___'
            });
          }
        }

        // Case 2: Subgraph Input (Peer -> Wrapper via Inner)
        if (toIsSubgraph && toIsSubgraph !== 'inline') {
          const wrapperId = baseToNodeId;
          // If rewired (targeting inner node), add dependency Source -> Wrapper
          if (toNodeId !== wrapperId) {
            flatConnections.push({
              fromNode: fromNodeId,
              fromPort: '___control___',
              toNode: wrapperId,
              toPort: '___control___'
            });
          }
        }
      }
    }


  }

  processGraph(appState.graph, '');

  // 3. Cycle Detection and Breaking (and Topological Sort)
  const adjacency = new Map<string, Array<{ toNode: string; connIndex: number }>>();
  const inDegree = new Map<string, number>();

  // Initialize in-degrees
  Object.keys(flatNodes).forEach(nodeId => inDegree.set(nodeId, 0));

  flatConnections.forEach((conn, index) => {
    if (!flatNodes[conn.fromNode] || !flatNodes[conn.toNode]) return;

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

  const validConnections = flatConnections
    .filter((_, index) => validConnectionIndices.has(index))
    .filter(c => flatNodes[c.fromNode] && flatNodes[c.toNode]);

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
    executionOrder,
    virtualInputMappings // Attach mappings for Executor
  };

  return {
    graph,
    inferredTypes,
    virtualInputMappings,
    outputRemappings
  };
}
