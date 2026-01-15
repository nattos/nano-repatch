
import { GraphDefinition, Structor, StructorRecord, ExecutionContext, PrimitiveNodeDefinition, StructorType } from "./structor";
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
  private graphInputs: Map<string, Structor> = new Map();
  private userNodeStates: Map<string, any> = new Map();
  private inspectedInputs: Map<string, StructorRecord> = new Map();
  private inferredNodeTypes: Record<string, { inputs: StructorType, outputs: StructorType }> | undefined;
  private downstreamMap: Map<string, string[]> = new Map();
  private nodeMetadata: Map<string, any> = new Map();
  private resolvedIdCache: Map<string, string> = new Map();

  // Optimization: Track nodes executed in the current tick
  private executedNodesThisTick: Set<string> = new Set();

  get graphNodeCount() {
    return this.executionOrder.length;
  }

  constructor(
    private graph: GraphDefinition,
    private repository: NodeRepository,
    initialStates?: Map<string, NodeState>,
    inferredNodeTypes?: Record<string, { inputs: StructorType, outputs: StructorType }>,
    dirtyNodeIds?: string[],
    nodeMetadata?: Record<string, any>,
    idMap?: Record<string, string>
  ) {
    this.inferredNodeTypes = inferredNodeTypes;

    if (idMap) {
      for (const [key, val] of Object.entries(idMap)) {
        this.resolvedIdCache.set(key, val);
      }
    }

    if (nodeMetadata) {
      for (const [key, val] of Object.entries(nodeMetadata)) {
        this.nodeMetadata.set(key, val);
      }
    }

    // Build downstream map for dirty propagation
    for (const conn of graph.connections) {
      if (!this.downstreamMap.has(conn.fromNode)) {
        this.downstreamMap.set(conn.fromNode, []);
      }
      this.downstreamMap.get(conn.fromNode)!.push(conn.toNode);
    }

    // Add Implicit Dependencies (Containment)
    // If a node is contained within another (executionOwnerId), marking the child dirty
    // should also mark the parent dirty so the subgraph can be re-executed.
    // We treat this as an implicit "downstream" connection.
    if (graph.nodes) {
      for (const [nodeId, node] of Object.entries(graph.nodes)) {
        if (node.executionOwnerId) {
          if (!this.downstreamMap.has(nodeId)) {
            this.downstreamMap.set(nodeId, []);
          }
          this.downstreamMap.get(nodeId)!.push(node.executionOwnerId);
        }
      }
    }



    // Split execution order
    this.splitExecutionOrder(graph.executionOrder || []);

    this.initializeStates(initialStates, dirtyNodeIds);
  }

  private mainExecutionOrder: string[] = [];
  // OwnerId -> Tag -> NodeIds[]
  private taggedExecutionOrders: Map<string, Map<string, string[]>> = new Map();

  private splitExecutionOrder(fullOrder: string[]) {
    this.mainExecutionOrder = [];
    this.taggedExecutionOrders.clear();

    for (const nodeId of fullOrder) {
      const node = this.graph.nodes[nodeId];
      if (node.executionTag && node.executionOwnerId) {
        // console.log(`[Executor] Node ${nodeId} Tagged tag=${node.executionTag} owner=${node.executionOwnerId}`);
        if (!this.taggedExecutionOrders.has(node.executionOwnerId)) {
          this.taggedExecutionOrders.set(node.executionOwnerId, new Map());
        }
        const tagMap = this.taggedExecutionOrders.get(node.executionOwnerId)!;
        if (!tagMap.has(node.executionTag)) {
          tagMap.set(node.executionTag, []);
        }
        tagMap.get(node.executionTag)!.push(nodeId);
      } else {
        this.mainExecutionOrder.push(nodeId);
      }
    }


  }

  public getInferredNodeTypes() {
    return this.inferredNodeTypes;
  }

  public getNodeState(nodeId: string): NodeState | undefined {
    return this.nodeStates.get(nodeId);
  }

  private initializeStates(initialStates?: Map<string, NodeState>, dirtyNodeIds?: string[]) {
    const explicitDirtySet = new Set(dirtyNodeIds || []);

    for (const [nodeId, instance] of Object.entries(this.graph.nodes)) {
      const definition = this.repository.get(instance.definitionId);
      const config = instance.defaultConfig ?? null;
      const isRealtime = (definition as Partial<PrimitiveNodeDefinition>)?.isRealtime?.(config ?? { fields: {} }) ?? false;

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
          definitionId: instance.definitionId,
          // Mark dirty if explicitly requested OR if old state was dirty
          isDirty: recoveredState.isDirty || explicitDirtySet.has(nodeId)
        };
        this.nodeStates.set(nodeId, state);
      } else {
        state = {
          output: { fields: {} },
          config: instance.defaultConfig ?? null,
          isDirty: true,
          isRealtime,
          definitionId: instance.definitionId
        };
        this.nodeStates.set(nodeId, state);
      }
    }
  }

  public setInput(inputName: string, value: Structor): void {
    this.graphInputs.set(inputName, value);
    const connection = this.graph.inputs[inputName];
    if (connection) {
      this.markDirty(connection.nodeId);
    }
  }

  /**
   * Resolves a node ID from the UI (which might be a short ID like "inner") to the
   * actual compiled node ID in the graph (which might be "if.inner").
   * This is necessary for Implicit Subgraphs (like core.ifthen) where the UI remains unaware of the compilation hierarchy.
   */
  private resolveNodeId(id: string): string {
    if (this.nodeStates.has(id)) return id;
    if (this.resolvedIdCache.has(id)) return this.resolvedIdCache.get(id)!;
    return id;
  }

  public setNodeConfig(nodeId: string, config: Structor): void {
    const resolvedId = this.resolveNodeId(nodeId);

    // Warn if not found, but allow fallthrough if it's strictly a graph input?
    // No, setNodeConfig is for nodes.
    const state = this.nodeStates.get(resolvedId);

    if (state) {
      // 1. Normalize Config: If definition specifies a Record config, move top-level props to 'fields'
      const nodeDef = this.repository.get(state.definitionId);
      const configType = (nodeDef as PrimitiveNodeDefinition)?.configType;

      let normalizedConfig = config;

      // Re-compile if metadata exists (and check if nodeDef supports compilesConfig)
      // Note: we are doing this BEFORE normalization to Record structure if possible?
      // No, compileConfig expects the UI Config (which IS 'config' here).
      // But wait, setNodeConfig receives UI Config from Inspector.
      const metadata = this.nodeMetadata.get(nodeId);
      if (nodeDef && nodeDef.kind === 'primitive' && nodeDef.compileConfig && metadata) {
        try {
          // NOTE: We should avoid calling compileConfig here if possible.
          // Ideally, all config compilation happens in the Compiler Worker to ensure strict separation.
          // However, for immediate valid updates here, we assume 'config' is the full UI state.

          const compiled = nodeDef.compileConfig(config, metadata);
          if (compiled) {
            normalizedConfig = compiled;
          }
        } catch (e) {
          console.warn(`Dynamic config compilation failed for ${nodeId}`, e);
        }
      }

      if (configType && configType.kind === 'record' && config && typeof config === 'object' && !Array.isArray(config)) {
        // If input is a flat object but target is a Record, try to map known fields
        const mappedFields: any = {};
        let movedAny = false;

        // Check both top-level keys AND keys inside 'values'
        // UI often updates 'values' (virtual inputs), but the compiled config expects them in 'fields'.
        // We flatten 'values' into the lookup scope to catch these updates.
        const sourceValues = {
          ...(config as any),
          ...((config as any).values || {})
        };

        for (const key of Object.keys(configType.fields)) {
          if (key in sourceValues) {
            mappedFields[key] = sourceValues[key];
            movedAny = true;
          }
        }

        if (movedAny) {
          // Create a new config object with fields, preserving other top-level keys (like 'values')
          normalizedConfig = {
            ...(config as object), // Keep values, etc.
            fields: mappedFields
          };
        }
      }

      if (normalizedConfig && typeof normalizedConfig === 'object' && !Array.isArray(normalizedConfig)) {
        // Object Merge: Shallow merge top-level, deep merge fields AND values
        const configToMerge = normalizedConfig as StructorRecord & { values?: any };
        const oldConfig = (state.config && typeof state.config === 'object' && !Array.isArray(state.config)) ? state.config : {};

        state.config = {
          ...oldConfig,
          ...normalizedConfig,
          fields: {
            ...((oldConfig as any).fields || {}),
            ...((configToMerge as any).fields || {})
          },
          values: {
            ...((oldConfig as any).values || {}),
            ...((configToMerge as any).values || {})
          }
        };
      } else {
        // Direct replacement (primitive or array)
        state.config = normalizedConfig;
      }

      // Update isRealtime based on new FULL config
      state.isRealtime = (nodeDef as Partial<PrimitiveNodeDefinition>)?.isRealtime?.(state.config ?? { fields: {} }) ?? false;
      this.markDirty(nodeId);

      // Recursive propagation for subgraph virtual inputs
      if (this.graph.virtualInputMappings && this.graph.virtualInputMappings[nodeId]) {
        const mappings = this.graph.virtualInputMappings[nodeId];
        const newValues = (state.config as any)?.values || {};

        for (const [portName, targetNodeId] of Object.entries(mappings)) {
          if (portName in newValues) {
            const newValue = newValues[portName];
            // Propagate to the inner node by updating its 'values' config
            // We do a partial update of just this value to avoid overwriting other state
            const targetState = this.nodeStates.get(targetNodeId);
            if (targetState) {
              // If target is io.input, we need to update 'values'
              // We construct a specific update object
              this.setNodeConfig(targetNodeId, { values: { [portName]: newValue } } as any);
            }
          }
        }
      }
    }
  }

  public getNodeConfig(nodeId: string): Structor | null | undefined {
    const resolvedId = this.resolveNodeId(nodeId);
    return this.nodeStates.get(resolvedId)?.config;
  }

  public hasNode(nodeId: string): boolean {
    return this.nodeStates.has(nodeId);
  }

  public markDirty(nodeId: string): void {
    const resolvedId = this.resolveNodeId(nodeId);
    const state = this.nodeStates.get(resolvedId);
    if (!state || state.isDirty) return;

    state.isDirty = true;
    for (const downstreamNodeId of this.downstreamMap.get(resolvedId) || []) {
      this.markDirty(downstreamNodeId);
    }
  }

  public update(context: Partial<ExecutionContext>): void {
    this.executedNodesThisTick.clear();
    const nodesToDirtyNextFrame = new Set<string>();

    // Mark realtime nodes as dirty
    for (const [nodeId, state] of this.nodeStates) {
      if (state.isRealtime) {
        this.markDirty(nodeId);
      }
    }

    for (const nodeId of this.mainExecutionOrder) {
      this.executeNode(nodeId, context, nodesToDirtyNextFrame);
    }

    // Consolidation Pass: Re-visit nodes that were marked dirty during execution (feedback loops)
    for (const nodeId of this.mainExecutionOrder) {
      this.executeNode(nodeId, context, nodesToDirtyNextFrame);
    }

    // Process re-dirty requests for the next frame
    for (const nodeId of nodesToDirtyNextFrame) {
      this.markDirty(nodeId);
    }
  }

  private executeNode(nodeId: string, context: Partial<ExecutionContext>, nodesToDirtyNextFrame: Set<string>) {
    const state = this.nodeStates.get(nodeId)!;
    if (!state.isDirty && !this.executedNodesThisTick.has(nodeId)) return;

    const instance = this.graph.nodes[nodeId];

    // Check for re-execution (Consolidation)
    // Note: executedNodesThisTick tracks if we ran *execute* (or consolidate) this tick.
    // If we are here again, it must be because we are manually invoked or we were marked dirty again?
    // Actually, executeNode checks 'isDirty' above.
    // If we are marked dirty AGAIN in the same tick, we come here.
    const isConsolidation = this.executedNodesThisTick.has(nodeId);

    const definition = this.repository.get(instance.definitionId);

    if (!definition || definition.kind !== 'primitive') {
      if (!definition) console.warn(`Definition not found for node ${nodeId}(defId: ${instance.definitionId})`);
      return;
    }

    if (isConsolidation) {
      if (definition.consolidate) {
        // Collect FULL inputs (some might be from loop closing)
        const inputRecord = this.collectInputs(nodeId, definition, state);

        // We do NOT mark dirty or re-propagate outputs.
        // This is purely for internal state update.

        const executionContext: ExecutionContext = {
          ...context,
          clock: context.clock ?? { beat: 0, dt: 0 },
          audio: context.audio,
          broadcast: (config, inputs) => broadcast(config, inputs),
          repository: this.repository,
          nodeState: this.userNodeStates,
          nodeId: nodeId,
          requestUiOutputs: false, // No UI output for consolidation
          markSelfDirty: () => { },
          executeSubgraph: () => { }
        };

        try {
          definition.consolidate(inputRecord, state.config as any, executionContext, this.userNodeStates.get(nodeId));
        } catch (error) {
          console.error(`Error consolidating node ${nodeId}:`, error);
        }
      }
      return;
    }

    this.executedNodesThisTick.add(nodeId);

    // 2. Collect inputs
    const inputRecord = this.collectInputs(nodeId, definition, state);



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
      requestUiOutputs: true, // Always true for now as requested
      markSelfDirty: () => {
        nodesToDirtyNextFrame.add(nodeId);
      },
      executeSubgraph: (tag: string) => {
        if (this.taggedExecutionOrders.has(nodeId)) {
          const tagMap = this.taggedExecutionOrders.get(nodeId)!;
          if (tagMap.has(tag)) {
            const subgraphNodes = tagMap.get(tag)!;
            // Execute all nodes in the subgraph
            for (const subNodeId of subgraphNodes) {
              // Force dirty to ensure execution
              const subState = this.nodeStates.get(subNodeId);
              if (subState) subState.isDirty = true;

              this.executeNode(subNodeId, context, nodesToDirtyNextFrame);
            }
          }
        }
      }
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
      console.error(`Error executing node ${nodeId} (${definition.id}): `, error);
      throw error; // Re-throw to stop execution or handle gracefully
    }
  }

  private collectInputs(nodeId: string, definition: PrimitiveNodeDefinition, state: NodeState): StructorRecord {
    const inputRecord: StructorRecord = { fields: {} };
    const nodeType = this.repository.getNodeType(definition.id);
    const inputsByPort = new Map<string, Structor[]>();

    const addToPort = (port: string, value: Structor) => {
      if (!inputsByPort.has(port)) {
        inputsByPort.set(port, []);
      }
      inputsByPort.get(port)!.push(value);
    };

    // Collect inputs from connections
    if (this.graph.connections) {
      for (const conn of this.graph.connections) {
        if (conn.toNode === nodeId) {
          const sourceNode = conn.fromNode;
          const sourcePort = conn.fromPort;

          // Resolve aliases if needed (handled in compiler mostly)

          const sourceState = this.nodeStates.get(sourceNode);
          const sourceOutput = sourceState ? sourceState.output : undefined;

          if (sourceOutput && sourceOutput.fields) {
            if (typeof sourcePort === 'string' && sourcePort in sourceOutput.fields) {
              const value = sourceOutput.fields[sourcePort];
              addToPort(conn.toPort.toString(), value);
            }
          }
        }
      }
    }

    for (const [graphInputName, conn] of Object.entries(this.graph.inputs)) {
      if (conn.nodeId === nodeId) {
        const value = this.graphInputs.get(graphInputName);
        if (value !== undefined) {
          addToPort(conn.port.toString(), value);
        }
      }
    }

    // Handle virtual inputs (values from config)
    if (state.config && typeof state.config === 'object' && 'values' in state.config) {
      const values = (state.config as any).values;
      if (values && typeof values === 'object') {
        for (const [portName, value] of Object.entries(values)) {
          // Only use virtual input if the port is NOT already connected/set
          if (!inputsByPort.has(portName)) {
            addToPort(portName, value as Structor);
          }
        }
      }
    }

    const inputSchema = nodeType?.inputs;

    // Process collected inputs into final record
    const allPorts = new Set<string>([...inputsByPort.keys()]);
    const inputSchemaMap = new Map<string, any>();

    if (Array.isArray(inputSchema)) {
      inputSchema.forEach(p => {
        allPorts.add(p.name);
        inputSchemaMap.set(p.name, p);
      });
    } else if (inputSchema) {
      Object.entries(inputSchema).forEach(([k, v]) => {
        allPorts.add(k);
        inputSchemaMap.set(k, v);
      });
    }

    for (const port of allPorts) {
      const schema = inputSchemaMap.get(port);
      const values = inputsByPort.get(port);

      // Determine if it expects an array input
      const schemaType = schema ? (schema.type || schema) : undefined;
      const isArrayType = schemaType && schemaType.kind === 'array';

      if (values && values.length > 0) {
        const lastValue = values[values.length - 1];
        if (schema && schema.allowMultiConnection) {
          inputRecord.fields[port] = values;
        } else if (isArrayType && !Array.isArray(lastValue)) {
          inputRecord.fields[port] = values;
        } else {
          inputRecord.fields[port] = lastValue;
        }
      } else {
        if (schema && schema.defaultValue !== undefined) {
          inputRecord.fields[port] = schema.defaultValue;
        }
      }
    }
    return inputRecord;
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
      // Fallback or legacy support if needed, but untagged is gone.
      return undefined; // or throw?
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
    const resolvedId = this.resolveNodeId(nodeId);
    const instance = this.graph.nodes[resolvedId];
    if (!instance) return;

    const definition = this.repository.get(instance.definitionId);
    if (!definition || definition.kind !== 'primitive' || !definition.onMessage) return;

    const userState = this.userNodeStates.get(resolvedId);
    // If state doesn't exist, we might need to wait or init?
    // Usually it exists if init happened.
    if (userState) {
      definition.onMessage(userState, message);
      this.markDirty(resolvedId);
    }
  }

  public getInspectedInputs(): Map<string, StructorRecord> {
    return this.inspectedInputs;
  }

  public getExecutedNodes(): Set<string> {
    return this.executedNodesThisTick;
  }
}
