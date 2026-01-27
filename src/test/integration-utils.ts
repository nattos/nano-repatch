
import { GraphExecutor } from '../structor/executor';
import { NodeRepository } from '../structor/repository';
import { ALL_PRIMITIVES } from '../structor/primitives';
import { compileGraph } from '../builder/compiler';
import { AppState, GridNode, Connection, GraphState } from '../builder/state';

// Helper to compile GridNodes into GraphDefinition
// Helper to compile GridNodes into GraphDefinition
export const compileAndRun = (
  nodes: Record<string, { typeId: string, config?: any, values?: any }>,
  connections: { from: string, port: string, to: string, portIn: string }[],
  monitoredNode: string,
  monitoredPort: string,
  extraRegistrations?: (repo: NodeRepository) => void,
  loadedSubgraphs: Map<string, GraphState> = new Map()
) => {
  const repository = new NodeRepository();

  // Register all primitives
  ALL_PRIMITIVES.forEach(def => {
    repository.register({
      id: def.id,
      version: '1.0.0',
      displayName: def.id,
      definition: def,
      getChildren: (def as any).getChildren,
      getRegion: (def as any).getRegion,
      inputs: Object.entries((def as any).inputs || {}).map(([name, type]) => ({
        name,
        type: type as any,
        allowMultiConnection: (type as any).allowMultiConnection,
        defaultValue: (type as any).defaultValue
      })),
      outputs: Object.entries((def as any).outputs || {}).map(([name, type]) => ({ name, type: type as any })),
      compileConfig: (uiConfig) => {
        // For literal, extract the value
        if (def.id === 'data.literal') {
          return uiConfig?.value;
        }
        // For lerp, handle clamp
        if (def.id === 'math.lerp') {
          return { ...uiConfig, fields: { clamp: uiConfig?.clamp ?? true }, };
        }
        if (def.id === 'core.pack') {
          return { ...uiConfig, fields: { targetType: uiConfig?.targetType ?? 'infer' } };
        }
        if (def.id === 'io.input') {
          return {
            fields: { name: uiConfig?.name ?? 'value' },
            values: uiConfig?.values
          };
        }
        return uiConfig ?? { fields: {} };
      }
    });
  });

  // Overwrite io.output with a simple mock for testing graph flow
  // This ensures we don't rely on complex dynamic port logic for simple value extraction
  repository.register({
    id: 'io.output',
    version: '1.0.0',
    displayName: 'Output',
    definition: {
      id: 'io.output',
      kind: 'primitive',
      configType: { kind: 'record', fields: {}, },
      computeOutputTypes: () => ({ kind: 'record', fields: { value: { kind: 'atomic', type: 'any' } }, }),
      execute: (inputs: any) => {
        return { fields: { value: inputs.fields.value }, };
      },
    } as any,
    inputs: [{ name: 'value', type: { kind: 'atomic', type: 'any' } as any }],
    outputs: [{ name: 'value', type: { kind: 'atomic', type: 'any' } as any }],
    compileConfig: (c) => ({ fields: {}, })
  });

  if (extraRegistrations) {
    extraRegistrations(repository);
  }

  const gridNodes: Record<string, GridNode> = {};
  const gridConnections: Record<string, Connection> = {};

  let x = 0;
  for (const [id, def] of Object.entries(nodes)) {
    gridNodes[id] = {
      id,
      x: (def as any).x !== undefined ? (def as any).x : x++,
      y: (def as any).y !== undefined ? (def as any).y : 0,
      config: {
        typeId: def.typeId,
        values: def.values || {},
        ...def.config
      }
    };
  }

  // Determine max X to place output node safely
  let maxX = x;
  Object.values(gridNodes).forEach(n => {
    if (n.x >= maxX) maxX = n.x + 1;
    // Also consider width if available in config?
    // But gridNodes doesn't have width in root property, it's in config or implicit.
    // Let's just add a generous buffer.
  });

  // Add output node
  const outId = 'out_node';
  gridNodes[outId] = {
    id: outId,
    x: maxX + 20, // Add buffer to avoid being captured by wide nodes like ifthen
    y: 0,
    config: { typeId: 'io.output', name: 'test_out', values: {} }
  };

  let connId = 0;
  for (const conn of connections) {
    const id = 'c' + (connId++).toString();
    gridConnections[id] = {
      id,
      fromNodeId: conn.from,
      fromPort: conn.port,
      toNodeId: conn.to,
      toPort: conn.portIn
    };
  }

  // Connect monitored node to output
  const outConnId = 'c' + (connId++).toString();

  gridConnections[outConnId] = {
    id: outConnId,
    fromNodeId: monitoredNode,
    fromPort: monitoredPort,
    toNodeId: outId,
    toPort: 'value'
  };

  const appState: AppState = {
    graph: {
      inner: { nodes: gridNodes, connections: gridConnections },
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    }
  };

  const { graph: graphDef, inferredTypes, idMap } = compileGraph(appState, loadedSubgraphs, repository, new Map());
  // console.log('Compiled Connections:', graphDef.connections);
  const executor = new GraphExecutor(graphDef, repository, undefined, inferredTypes, undefined, undefined, idMap);
  // console.log('Execution Order:', (executor as any).executionOrder);

  return {
    executor,
    getOutput: () => executor.getGraphOutput('test_out'),
    updateConfig: (nodeId: string, newConfig: any) => executor.setNodeConfig(nodeId, newConfig),
    repository // Export repo for manual checks
  };
};
