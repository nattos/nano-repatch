import {
  PrimitiveNodeDefinition,
  ExecutionContext,
  StructorRecord,
  Structor
} from './structor';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { GridNode } from '../builder/state';

export interface NodeHarness<TInputs, TOutputs> {
  execute: (inputs: Partial<TInputs>, config?: any) => TOutputs;
  executor: GraphExecutor;
}

export function createNodeHarness<TInputs, TOutputs>(
  definition: PrimitiveNodeDefinition,
  repository?: NodeRepository
): NodeHarness<TInputs, TOutputs> {
  const repo = repository || new NodeRepository();

  // Register the node if not already registered (or if using a fresh repo)
  // We need a minimal NodeType wrapper
  if (!repo.getNodeType(definition.id)) {
      repo.register({
          id: definition.id,
          version: '1.0.0',
          displayName: definition.id,
          definition: definition,
          // We need inputs/outputs for defaults to work!
          // If definition has inputs exposed (via our recent change), use them.
          inputs: definition.inputs ? Object.entries(definition.inputs).map(([name, type]: [string, any]) => ({
              name,
              type,
              defaultValue: (type as any).defaultValue
          })) : [],
          outputs: [] // Outputs don't matter for execution logic mostly
      });
  }

  // Build the graph once
  const nodeId = 'target';
  const nodes: Record<string, GridNode> = {
      [nodeId]: {
          id: nodeId,
          x: 0, y: 0,
          config: {
              typeId: definition.id,
              values: {}
          }
      }
  };

  const connections: any[] = [];
  const graphInputs: Record<string, any> = {};
  const graphOutputs: Record<string, any> = {};

  // Create graph inputs for each node input
  if (definition.inputs) {
      for (const [name, type] of Object.entries(definition.inputs)) {
          graphInputs[name] = { nodeId, port: name };
      }
  }

  // Create graph outputs for each node output
  // We need to know output names.
  // definition.computeOutputTypes() returns RecordType.
  const outputType = definition.computeOutputTypes ? definition.computeOutputTypes(
      { kind: 'record', fields: {} },
      { kind: 'record', fields: {} },
      { beat: 0, dt: 0, broadcast: () => ({ apply: () => {} }) } as any
  ) : { kind: 'record', fields: {} } as any;

  if (outputType.kind === 'record') {
      for (const name of Object.keys(outputType.fields)) {
          graphOutputs[name] = { nodeId, port: name };
      }
  }

  const graphDef = {
      id: 'test-graph',
      kind: 'graph' as const,
      type: { kind: 'graph' as const, inputs: { kind: 'record' as const, fields: {} }, outputs: { kind: 'record' as const, fields: {} } },
      nodes,
      connections,
      inputs: graphInputs,
      outputs: graphOutputs,
      executionOrder: [nodeId]
  };

  // Populate nodes in graphDef (GraphDefinition expects NodeInstance, not GridNode)
  // GridNode has config, NodeInstance has defaultConfig.
  const graphDefNodes: Record<string, any> = {};
  for (const [nid, n] of Object.entries(nodes)) {
      graphDefNodes[nid] = {
          definitionId: n.config.typeId,
          defaultConfig: { fields: n.config.values || {} }
      };
  }
  (graphDef as any).nodes = graphDefNodes;

  const executor = new GraphExecutor(graphDef as any, repo);

  return {
    executor,
    execute: (inputs: Partial<TInputs>, config?: any) => {
      // Update config if provided
      if (config) {
          executor.setNodeConfig(nodeId, { fields: config });
      }

      // Reset all inputs to undefined first to ensure isolation
      if (definition.inputs) {
          for (const name of Object.keys(definition.inputs)) {
              executor.setInput(name, undefined as any);
          }
      }

      // Set inputs
      for (const [key, value] of Object.entries(inputs)) {
          executor.setInput(key, value as any);
      }

      // Run
      const context: ExecutionContext = {
          broadcast: (c, i) => ({ apply: (f) => f(i) }), // Mock broadcast
          repository: repo,
          clock: { beat: 0, dt: 0 },
          nodeState: new Map(),
          audio: {} as any // Mock audio
      };

      executor.update(context);

      // Get output
      const output = executor.getNodeOutput(nodeId);
      return output?.fields as TOutputs;
    }
  };
}
