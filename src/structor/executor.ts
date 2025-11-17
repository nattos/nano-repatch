import { GraphDefinition, NodeDefinition, Structor, StructorRecord, ExecutionContext } from "./structor";
import { NodeRepository } from "./repository";

export class GraphExecutor {
    private nodeOutputs: Map<string, StructorRecord> = new Map();
    private dirtyNodes: Set<string> = new Set();
    private executionOrder: string[] = [];
    private downstreamMap: Map<string, string[]> = new Map();
    private upstreamMap: Map<string, string[]> = new Map();
    private graphInputs: Map<string, Structor> = new Map();

    constructor(private graph: GraphDefinition, private repository: NodeRepository) {
        this.buildDependencyMaps();
        this.initializeOutputs();
    }

    private buildDependencyMaps() {
        const nodeIds = Object.keys(this.graph.nodes);
        const inDegree: Map<string, number> = new Map();

        for (const nodeId of nodeIds) {
            this.downstreamMap.set(nodeId, []);
            this.upstreamMap.set(nodeId, []);
            inDegree.set(nodeId, 0);
        }

        for (const conn of this.graph.connections) {
            this.downstreamMap.get(conn.fromNode)?.push(conn.toNode);
            this.upstreamMap.get(conn.toNode)?.push(conn.fromNode);
            inDegree.set(conn.toNode, (inDegree.get(conn.toNode) || 0) + 1);
        }

        // Topological Sort (Kahn's algorithm)
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

    private initializeOutputs() {
        for (const nodeId of Object.keys(this.graph.nodes)) {
            this.nodeOutputs.set(nodeId, { fields: {}, untagged: [] });
            this.dirtyNodes.add(nodeId);
        }
    }

    public setInput(inputName: string, value: Structor): void {
        this.graphInputs.set(inputName, value);
        const connection = this.graph.inputs[inputName];
        if (connection) {
            this.markDirty(connection.nodeId);
        }
    }

    public markDirty(nodeId: string): void {
        if (this.dirtyNodes.has(nodeId)) return;
        this.dirtyNodes.add(nodeId);
        for (const downstreamNodeId of this.downstreamMap.get(nodeId) || []) {
            this.markDirty(downstreamNodeId);
        }
    }

    public update(): void {
        for (const nodeId of this.executionOrder) {
            if (!this.dirtyNodes.has(nodeId)) {
                continue;
            }

            const instance = this.graph.nodes[nodeId];
            const definition = this.repository.get(instance.definitionId);

            if (!definition || definition.kind !== 'primitive') {
                continue;
            }

            const inputRecord: StructorRecord = { fields: {}, untagged: [] };

            // Gather inputs from upstream nodes
            for (const conn of this.graph.connections) {
                if (conn.toNode === nodeId) {
                    const upstreamOutput = this.nodeOutputs.get(conn.fromNode);
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

            // Gather inputs from graph inputs
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
                    // This is a placeholder. A real broadcast engine is needed.
                    // For the tests, this will be mocked.
                    if (config.reshape === 'vector') {
                        const values = [...Object.values(inputs.fields), ...inputs.untagged];
                        return { broadcasted: [values] };
                    }
                    return { fields: {} };
                },
                repository: this.repository
            };

            const outputRecord = definition.execute(inputRecord, context);
            this.nodeOutputs.set(nodeId, outputRecord);
        }

        this.dirtyNodes.clear();
    }



    public getNodeOutput(nodeId: string): StructorRecord | undefined {
        return this.nodeOutputs.get(nodeId);
    }

    public getGraphOutput(outputName: string): Structor | undefined {
        const connection = this.graph.outputs[outputName];
        if (!connection) return undefined;

        const nodeOutput = this.nodeOutputs.get(connection.nodeId);
        if (!nodeOutput) return undefined;

        if (typeof connection.port === 'string') {
            return nodeOutput.fields[connection.port];
        } else {
            return nodeOutput.untagged[connection.port];
        }
    }
}