
import { GraphDefinition, Structor, StructorRecord, ExecutionContext, PrimitiveNodeDefinition } from "./structor";
import { NodeRepository } from "./repository";
import { broadcast } from "./broadcast";

export interface NodeState {
  output: StructorRecord;
  config: Structor | null;
  isDirty: boolean;
  isRealtime: boolean;
  definitionId: string;
}

export class GraphExecutor {
  private nodeStates: Map<string, NodeState> = new Map();
  private executionOrder: string[] = [];
  private downstreamMap: Map<string, string[]> = new Map();
  private graphInputs: Map<string, Structor> = new Map();
  private userNodeStates: Map<string, any> = new Map();
  private inspectedInputs: Map<string, StructorRecord> = new Map();

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
      let state: NodeState;
      if (initialStates && initialStates.has(nodeId)) {
        const oldState = initialStates.get(nodeId)!;
        // Check if definition matches. If not, we cannot reuse state safely.
        if (oldState.definitionId === instance.definitionId) {
          recoveredState = oldState;
        }
      }

      if (recoveredState) {
        state = {
          ...recoveredState,
          // Always update config and realtime status from new graph definition
          config: instance.defaultConfig ?? null,
          isRealtime,
          definitionId: instance.definitionId
        };
        this.nodeStates.set(nodeId, state);
      } else {
        state = {
          output: { fields: {}, untagged: [] },
          config: instance.defaultConfig ?? null,
          isDirty: true,
          isRealtime,
          definitionId: instance.definitionId
        };
        this.nodeStates.set(nodeId, state);
      }
    }
  }

  // Also recover userNodeStates (internal state of nodes)
  // We need to pass this in too?
  // The `NodeState` interface doesn't include `userNodeStates`.
  // `userNodeStates` is a separate map in `GraphExecutor`.
  // We need to handle that too.


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

  public hasNode(nodeId: string): boolean {
    return this.nodeStates.has(nodeId);
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

      // 2. Collect inputs
      const inputRecord: StructorRecord = { fields: {}, untagged: [] };

      for (const conn of this.graph.connections) {
        if (conn.toNode === nodeId) {
          const upstreamOutput = this.nodeStates.get(conn.fromNode)?.output;
          if (upstreamOutput) {
            const fromPort = conn.fromPort;
            const toPort = conn.toPort;

            // Check for port redirection (e.g. named port -> untagged)
            const nodeType = this.repository.getNodeType(instance.definitionId);
            let portHint;
            if (typeof toPort === 'string') {
              portHint = nodeType?.inputs?.find(p => p.name === toPort);
            } else if (typeof toPort === 'number') {
              portHint = nodeType?.inputs?.[toPort];
            }
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
              // Try to map to named port
              const namedPort = nodeType?.inputs?.[toPort];
              if (namedPort && namedPort.name) {
                inputRecord.fields[namedPort.name] = value;
              } else {
                inputRecord.untagged[toPort] = value;
              }
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

      // Apply default values from Node Definition
      const nodeType = this.repository.getNodeType(instance.definitionId);
      if (nodeType && nodeType.inputs) {
        for (const input of nodeType.inputs) {
          if (inputRecord.fields[input.name] === undefined && input.defaultValue !== undefined) {
            inputRecord.fields[input.name] = input.defaultValue;
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
        nodeId: nodeId,
        requestUiOutputs: true // Always true for now as requested
      };

      // Execute
      try {
        // Capture inputs if requested
        if ((definition as any).inspectInputs) {
           this.inspectedInputs.set(nodeId, inputRecord);
        }

        const result = definition.execute(inputRecord, state.config as any, executionContext);

        // Handle result (ExecuteResult)
        if ('outputs' in result && 'ui' in result) {
            state.output = result.outputs;
            (state as any).uiOutput = result.ui;
        } else if ('outputs' in result) {
            state.output = result.outputs as StructorRecord;
            // No UI output
            (state as any).uiOutput = undefined;
        } else {
             state.output = result as StructorRecord;
             (state as any).uiOutput = undefined;
        }

        state.isDirty = false;
      } catch (error) {
        console.error(`Error executing node ${nodeId} (${definition.id}):`, error);
        throw error; // Re-throw to stop execution or handle gracefully
      }
    }
  }

  public getOutputs(): Map<string, StructorRecord> {
    const allOutputs = new Map<string, StructorRecord>();
    for (const [nodeId, state] of this.nodeStates.entries()) {
      allOutputs.set(nodeId, state.output);
    }
    return allOutputs;
  }

  public getUiOutputs(): Map<string, any> {
    const allUiOutputs = new Map<string, any>();
    for (const [nodeId, state] of this.nodeStates.entries()) {
        const ui = (state as any).uiOutput;
        if (ui !== undefined) {
            allUiOutputs.set(nodeId, ui);
        }
    }
    return allUiOutputs;
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

  public getInputs(): Map<string, Structor> {
    return this.graphInputs;
  }

  public handleNodeMessage(nodeId: string, message: any): void {
    const instance = this.graph.nodes[nodeId];
    if (!instance) return;

    const definition = this.repository.get(instance.definitionId);
    if (!definition || definition.kind !== 'primitive' || !definition.onMessage) return;

    const userState = this.userNodeStates.get(nodeId);
    // If state doesn't exist, we might need to wait or init?
    // Usually it exists if init happened.
    if (userState) {
        definition.onMessage(userState, message);
    }
  }

  public getInspectedInputs(): Map<string, StructorRecord> {
    return this.inspectedInputs;
  }
}
