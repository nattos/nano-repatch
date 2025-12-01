
import { GraphDefinition, Structor, StructorRecord, ExecutionContext, PrimitiveNodeDefinition } from "./structor";
import { NodeRepository } from "./repository";
import { broadcast } from "./broadcast";

export interface NodeState {
  output: StructorRecord;
  config: Structor | null;
  isDirty: boolean;
  isRealtime: boolean;
}

export class GraphExecutor {
  private nodeStates: Map<string, NodeState> = new Map();
  private executionOrder: string[] = [];
  private downstreamMap: Map<string, string[]> = new Map();
  private graphInputs: Map<string, Structor> = new Map();
  private userNodeStates: Map<string, any> = new Map();

  get graphNodeCount() {
    return this.executionOrder.length;
  }

  constructor(private graph: GraphDefinition, private repository: NodeRepository, initialStates?: Map<string, NodeState>) {
    this.buildDependencyMaps();
    this.initializeStates(initialStates);
  }

  private buildDependencyMaps() {
    const nodeIds = Object.keys(this.graph.nodes);
    const inDegree: Map<string, number> = new Map();

    for (const nodeId of nodeIds) {
      this.downstreamMap.set(nodeId, []);
      inDegree.set(nodeId, 0);
    }

    for (const conn of this.graph.connections) {
      this.downstreamMap.get(conn.fromNode)?.push(conn.toNode);
      inDegree.set(conn.toNode, (inDegree.get(conn.toNode) || 0) + 1);
    }

    const queue: string[] = [];
    for (const nodeId of nodeIds) {
      if (inDegree.get(nodeId) === 0) {
        queue.push(nodeId);
      }
    }

    while (queue.length > 0) {
      const u = queue.shift()!;
      this.executionOrder.push(u);
      for (const v of this.downstreamMap.get(u) || []) {
        inDegree.set(v, (inDegree.get(v) || 0) - 1);
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      }
    }

    if (this.executionOrder.length !== nodeIds.length) {
      throw new Error("Graph contains a cycle");
    }
  }

  private initializeStates(initialStates?: Map<string, NodeState>) {
    for (const [nodeId, instance] of Object.entries(this.graph.nodes)) {
      const definition = this.repository.get(instance.definitionId);
      const config = instance.defaultConfig ?? null;
      const isRealtime = (definition as Partial<PrimitiveNodeDefinition>)?.isRealtime?.(config ?? { fields: {}, untagged: [] }) ?? false;

      // Try to recover state if available and compatible
      let recoveredState: NodeState | undefined;
      if (initialStates && initialStates.has(nodeId)) {
        const oldState = initialStates.get(nodeId)!;
        // Simple compatibility check: same definition ID?
        // We could be more robust, but this is a good start.
        // We assume if the node ID is preserved, it's the same logical node.
        // But if the definition changed, we shouldn't reuse state.
        // Actually, the graph compilation preserves IDs for the same "user node".
        // But the user might have changed the type of the node.
        // So we should check if the definitionId matches?
        // The old state doesn't store definitionId directly, but we can assume the caller handles it or we just trust the ID.
        // Let's trust the ID for now, but maybe reset if config is drastically different?
        // Actually, `config` is in the state.

        // We should probably use the NEW config, but keep the OLD output?
        // Or keep the old config?
        // If we are recompiling, it might be because config changed.
        // So we should probably use the new config.
        // But we want to preserve the *internal* state if any (like accumulator values).
        // Wait, NodeState only has `output`, `config`, `isDirty`, `isRealtime`.
        // It doesn't have internal state for the node itself (like `accumulator` for a counter).
        // Where is that stored?
        // Ah, `userNodeStates` map!

        recoveredState = oldState;
      }

      if (recoveredState) {
        this.nodeStates.set(nodeId, {
          ...recoveredState,
          // Always update config and realtime status from new graph definition
          config: instance.defaultConfig ?? null,
          isRealtime
        });
      } else {
        this.nodeStates.set(nodeId, {
          output: { fields: {}, untagged: [] },
          config: instance.defaultConfig ?? null,
          isDirty: true,
          isRealtime,
        });
      }
    }

    // Also recover userNodeStates (internal state of nodes)
    // We need to pass this in too?
    // The `NodeState` interface doesn't include `userNodeStates`.
    // `userNodeStates` is a separate map in `GraphExecutor`.
    // We need to handle that too.
  }

  public setInput(inputName: string, value: Structor): void {
    this.graphInputs.set(inputName, value);
    const connection = this.graph.inputs[inputName];
    if (connection) {
      this.markDirty(connection.nodeId);
    }
  }

  public setNodeConfig(nodeId: string, config: Structor): void {
    const state = this.nodeStates.get(nodeId);
    if (state) {
      state.config = config;
      const instance = this.graph.nodes[nodeId];
      const definition = this.repository.get(instance.definitionId);
      state.isRealtime = (definition as Partial<PrimitiveNodeDefinition>)?.isRealtime?.(config ?? { fields: {}, untagged: [] }) ?? false;
      this.markDirty(nodeId);
    }
  }

  public getNodeConfig(nodeId: string): Structor | null | undefined {
    return this.nodeStates.get(nodeId)?.config;
  }

  public markDirty(nodeId: string): void {
    const state = this.nodeStates.get(nodeId);
    if (!state || state.isDirty) return;

    state.isDirty = true;
    for (const downstreamNodeId of this.downstreamMap.get(nodeId) || []) {
      this.markDirty(downstreamNodeId);
    }
  }

  public update(context: Partial<ExecutionContext>): void {
    // Mark realtime nodes as dirty
    for (const [nodeId, state] of this.nodeStates) {
      if (state.isRealtime) {
        this.markDirty(nodeId);
      }
    }

    for (const nodeId of this.executionOrder) {
      const state = this.nodeStates.get(nodeId)!;
      if (!state.isDirty) continue;

      const instance = this.graph.nodes[nodeId];
      const definition = this.repository.get(instance.definitionId);

      if (!definition || definition.kind !== 'primitive') {
        if (!definition) console.warn(`Definition not found for node ${nodeId}`);
        continue;
      }

      // Collect inputs
      const inputRecord: StructorRecord = { fields: {}, untagged: [] };

      for (const conn of this.graph.connections) {
        if (conn.toNode === nodeId) {
          const upstreamOutput = this.nodeStates.get(conn.fromNode)?.output;
          if (upstreamOutput) {
            const fromPort = conn.fromPort;
            const toPort = conn.toPort;

            // Check for port redirection (e.g. named port -> untagged)
            const nodeType = this.repository.getNodeType(instance.definitionId);
            const portHint = nodeType?.inputs?.find(p => p.name === toPort);
            const redirect = portHint?.redirect;

            let value: Structor;
            if (typeof fromPort === 'string' && fromPort) {
              value = upstreamOutput.fields[fromPort]
            } else if (typeof fromPort === 'number') {
              value = upstreamOutput.untagged[fromPort];
            } else {
              value = upstreamOutput.untagged[0];
            }

            if (redirect === 'untagged') {
              inputRecord.untagged.push(value);
            } else if (typeof toPort === 'string' && toPort) {
              inputRecord.fields[toPort] = value;
            } else if (typeof toPort === 'number') {
              inputRecord.untagged[toPort] = value;
            } else {
              inputRecord.untagged.push(value);
            }
          }
        }
      }

      for (const [graphInputName, conn] of Object.entries(this.graph.inputs)) {
        if (conn.nodeId === nodeId) {
          const value = this.graphInputs.get(graphInputName);
          if (value !== undefined) {
            if (typeof conn.port === 'string') {
              inputRecord.fields[conn.port] = value;
            } else {
              inputRecord.untagged[conn.port] = value;
            }
          }
        }
      }

      // Handle virtual inputs (values from config)
      if (state.config && typeof state.config === 'object' && 'values' in state.config) {
        const values = (state.config as any).values;
        if (values && typeof values === 'object') {
          for (const [portName, value] of Object.entries(values)) {
            // Only use virtual input if the port is NOT already connected/set
            if (inputRecord.fields[portName] === undefined) {
              inputRecord.fields[portName] = value as Structor;
            }
          }
        }
      }

      const executionContext: ExecutionContext = {
        ...context,
        // Ensure required properties are present if not in context (though context is partial)
        // Actually, we provide the missing parts below.
        // But TypeScript might complain if we spread Partial into ExecutionContext.
        // We need to construct it carefully.

        // We need to provide defaults for clock if missing
        clock: context.clock ?? { beat: 0, dt: 0 },
        audio: context.audio,
        broadcast: (config, inputs) => broadcast(config, inputs),
        repository: this.repository,
        nodeState: this.userNodeStates,
        nodeId: nodeId
      };

      state.output = definition.execute(inputRecord, state.config as any, executionContext);
      state.isDirty = false;
    }
  }

  public getOutputs(): Map<string, StructorRecord> {
    const allOutputs = new Map<string, StructorRecord>();
    for (const [nodeId, state] of this.nodeStates.entries()) {
      allOutputs.set(nodeId, state.output);
    }
    return allOutputs;
  }

  public getNodeOutput(nodeId: string): StructorRecord | undefined {
    return this.nodeStates.get(nodeId)?.output;
  }

  public getGraphOutput(outputName: string): Structor | undefined {
    const connection = this.graph.outputs[outputName];
    if (!connection) return undefined;

    const nodeOutput = this.nodeStates.get(connection.nodeId)?.output;
    if (!nodeOutput) return undefined;

    if (typeof connection.port === 'string') {
      return nodeOutput.fields[connection.port];
    } else {
      return nodeOutput.untagged[connection.port];
    }
  }
  public getNodeStates(): Map<string, NodeState> {
    return this.nodeStates;
  }

  public getUserNodeStates(): Map<string, any> {
    return this.userNodeStates;
  }

  public setUserNodeStates(states: Map<string, any>) {
    this.userNodeStates = states;
  }
}
