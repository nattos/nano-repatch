
import { GraphDefinition, NodeDefinition, Structor, StructorRecord, ExecutionContext } from "./structor";
import { NodeRepository } from "./repository";

interface NodeState {
    output: StructorRecord;
    config: Structor | null;
    isDirty: boolean;
}

export class GraphExecutor {
    private nodeStates: Map<string, NodeState> = new Map();
    private executionOrder: string[] = [];
    private downstreamMap: Map<string, string[]> = new Map();
    private graphInputs: Map<string, Structor> = new Map();

    constructor(private graph: GraphDefinition, private repository: NodeRepository) {
        this.buildDependencyMaps();
        this.initializeStates();
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

    private initializeStates() {
        for (const [nodeId, instance] of Object.entries(this.graph.nodes)) {
            this.nodeStates.set(nodeId, {
                output: { fields: {}, untagged: [] },
                config: instance.defaultConfig ?? null,
                isDirty: true,
            });
        }
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

    public update(): void {
        for (const nodeId of this.executionOrder) {
            const state = this.nodeStates.get(nodeId);
            if (!state || !state.isDirty) {
                continue;
            }

            const instance = this.graph.nodes[nodeId];
            const definition = this.repository.get(instance.definitionId);

            if (!definition || definition.kind !== 'primitive') {
                continue;
            }

            const inputRecord: StructorRecord = { fields: {}, untagged: [] };

            for (const conn of this.graph.connections) {
                if (conn.toNode === nodeId) {
                    const upstreamOutput = this.nodeStates.get(conn.fromNode)?.output;
                    if (upstreamOutput) {
                        const value = typeof conn.fromPort === 'string'
                            ? upstreamOutput.fields[conn.fromPort]
                            : upstreamOutput.untagged[conn.fromPort];
                        
                        if (typeof conn.toPort === 'string') {
                            inputRecord.fields[conn.toPort] = value;
                        } else {
                            inputRecord.untagged[conn.toPort] = value;
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

            const context: ExecutionContext = {
                broadcast: (config, inputs) => {
                    if (config.reshape === 'vector') {
                        const values = [...Object.values(inputs.fields), ...inputs.untagged];
                        return { broadcasted: [values] };
                    }
                    return { fields: {} };
                },
                repository: this.repository
            };
            
            state.output = definition.execute(inputRecord, state.config, context);
            state.isDirty = false;
        }
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
}
