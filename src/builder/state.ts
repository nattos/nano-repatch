import { observable, action, makeObservable, configure } from 'mobx';
import { produce, setAutoFreeze, enableMapSet } from 'immer';

// Enable Immer support for Map and Set
enableMapSet();

// Immer and MobX can have issues working together if Immer freezes the state.
// We disable auto-freezing to allow MobX to wrap the state objects.
setAutoFreeze(false);

// Enforce MobX strict mode
configure({
    enforceActions: "always",
    computedRequiresReaction: true,
    reactionRequiresObservable: true,
    observableRequiresReaction: true,
});

// Simple ID generator
let nextId = 0;
const generateId = (prefix: string) => `${prefix}-${nextId++}`;

// Part 1: Core Data Structures
export interface GridNode {
    id: string;
    x: number;
    y: number;
    config: {
        typeId: string;
        [key: string]: any;
    };
}

export interface Connection {
    id:string;
    fromNodeId: string;
    fromPort: string | number;
    toNodeId: string;
    toPort: string | number;
    config?: {
        tag?: string;
    };
}

// The canonical, serializable state of the graph
export interface GraphState {
    nodes: Record<string, GridNode>;
    connections: Record<string, Connection>;
}

// The full application state, including the canonical graph and
// derived, non-serializable lookup maps for performance.
export interface AppState {
    graph: GraphState;
    selection: Set<string>;
    auxiliary: {
        // map from a node ID to the IDs of its outgoing connections
        outgoingConnections: Map<string, string[]>;
        // map from a node ID to the IDs of its incoming connections
        incomingConnections: Map<string, string[]>;
    };
}

// Part 2: Mutations
export type AppMutation =
    | { type: 'node.create', node: GridNode }
    | { type: 'node.delete', node: GridNode }
    | { type: 'node.move', moves: { nodeId: string, from: {x: number, y: number}, to: {x: number, y: number} }[] }
    | { type: 'node.setConfig', nodeId: string, from: Partial<any>, to: Partial<any> }
    | { type: 'connection.create', connection: Connection }
    | { type: 'connection.delete', connection: Connection }
    | { type: 'connection.setConfig', connectionId: string, from: Partial<any>, to: Partial<any> }
    | { type: 'selection.set', from: Set<string>, to: Set<string> };

// Part 3: The Controller
export class AppController {
    private currentState: AppState;
    public observableState: AppState;

    private undoStack: AppMutation[][] = [];
    private redoStack: AppMutation[][] = [];

    // State for handling transactions
    private isTransactionActive: boolean = false;
    private bufferedMutations: AppMutation[] = [];
    private draftState: AppState | null = null;

    constructor(initialState?: GraphState) {
        const graphState = initialState || { nodes: {}, connections: {} };
        this.currentState = {
            graph: graphState,
            selection: new Set(),
            auxiliary: this.buildAuxiliaryMaps(graphState),
        };
        // MobX can make Maps and Sets observable directly
        this.observableState = observable(this.currentState);
        
        makeObservable(this, {
            observableState: observable,
            applyMutationsToObservable: action,
        });
    }

    public getState(): Readonly<AppState> {
        return this.isTransactionActive && this.draftState ? this.draftState : this.currentState;
    }

    public dispatch(mutations: AppMutation[], isUndoRedo: boolean = false): void {
        if (mutations.length === 0) return;

        if (this.isTransactionActive) {
            this.bufferedMutations.push(...mutations);
            this.applyMutations(this.draftState!, mutations);
            return;
        }

        const nextState = produce(this.currentState, draft => {
            this.applyMutations(draft as AppState, mutations);
        });

        if (nextState !== this.currentState) {
            this.currentState = nextState;
            this.applyMutationsToObservable(mutations);

            if (!isUndoRedo) {
                const inverseMutations = this.createInverse(mutations);
                this.undoStack.push(inverseMutations);
                this.redoStack = [];
            }
        }
    }

    public transaction(callback: (draftController: this) => void): void {
        this.isTransactionActive = true;
        this.bufferedMutations = [];
        this.draftState = JSON.parse(JSON.stringify(this.currentState, (key, value) => 
            (value instanceof Map || value instanceof Set) ? Array.from(value.entries()) : value
        ));
        // Re-hydrate maps and sets after serialization
        if (this.draftState) {
            this.draftState.auxiliary.incomingConnections = new Map(this.draftState.auxiliary.incomingConnections);
            this.draftState.auxiliary.outgoingConnections = new Map(this.draftState.auxiliary.outgoingConnections);
            this.draftState.selection = new Set(this.draftState.selection);
        }


        try {
            callback(this);
            const mutationsToDispatch = [...this.bufferedMutations];
            this.isTransactionActive = false;
            this.bufferedMutations = [];
            this.draftState = null;
            this.dispatch(mutationsToDispatch);
        } catch (e) {
            this.isTransactionActive = false;
            this.bufferedMutations = [];
            this.draftState = null;
            throw e;
        }
    }

    public createNode(typeId: string, x: number, y: number): GridNode {
        const newNode: GridNode = {
            id: generateId('node'),
            x,
            y,
            config: { typeId },
        };
        this.dispatch([{ type: 'node.create', node: newNode }]);
        return newNode;
    }

    public deleteNode(nodeId: string): void {
        const state = this.getState();
        const nodeToDelete = state.graph.nodes[nodeId];
        if (!nodeToDelete) return;

        const mutations: AppMutation[] = [];
        for (const conn of Object.values(state.graph.connections)) {
            if (conn.fromNodeId === nodeId || conn.toNodeId === nodeId) {
                mutations.push({ type: 'connection.delete', connection: conn });
            }
        }
        mutations.push({ type: 'node.delete', node: nodeToDelete });
        this.dispatch(mutations);
    }

    public createConnection(fromNodeId: string, fromPort: string | number, toNodeId: string, toPort: string | number): Connection {
        const newConnection: Connection = { id: generateId('conn'), fromNodeId, fromPort, toNodeId, toPort };
        this.dispatch([{ type: 'connection.create', connection: newConnection }]);
        return newConnection;
    }

    public deleteConnection(connectionId: string): void {
        const connToDelete = this.getState().graph.connections[connectionId];
        if (connToDelete) {
            this.dispatch([{ type: 'connection.delete', connection: connToDelete }]);
        }
    }

    public moveNodes(nodeIds: string[], dx: number, dy: number): void {
        const state = this.getState();
        const moves = nodeIds.map(id => {
            const node = state.graph.nodes[id];
            return { nodeId: id, from: { x: node.x, y: node.y }, to: { x: node.x + dx, y: node.y + dy } };
        });
        this.dispatch([{ type: 'node.move', moves }]);
    }

    public setNodeConfig(nodeId: string, configUpdate: Partial<any>): void {
        const state = this.getState();
        const fromConfig: Partial<any> = {};
        const currentNode = state.graph.nodes[nodeId];
        for (const key in configUpdate) {
            if (Object.prototype.hasOwnProperty.call(configUpdate, key)) {
                fromConfig[key] = currentNode.config[key];
            }
        }
        this.dispatch([{ type: 'node.setConfig', nodeId, from: fromConfig, to: configUpdate }]);
    }

    public setConnectionConfig(connectionId: string, configUpdate: Partial<any>): void {}

    public selectNodes(nodeIds: string[], additive: boolean = false): void {
        const state = this.getState();
        const newSelection = additive ? new Set(state.selection) : new Set<string>();
        for (const id of nodeIds) {
            newSelection.add(id);
        }
        this.dispatch([{ type: 'selection.set', from: state.selection, to: newSelection }]);
    }
    
    public undo(): void {
        const mutationsToUndo = this.undoStack.pop();
        if (mutationsToUndo) {
            const redoMutations = this.createInverse(mutationsToUndo);
            this.redoStack.push(redoMutations);
            this.dispatch(mutationsToUndo, true);
        }
    }

    public redo(): void {
        const mutationsToRedo = this.redoStack.pop();
        if (mutationsToRedo) {
            const undoMutations = this.createInverse(mutationsToRedo);
            this.undoStack.push(undoMutations);
            this.dispatch(mutationsToRedo, true);
        }
    }

    private buildAuxiliaryMaps(graphState: GraphState): AppState['auxiliary'] {
        const outgoingConnections = new Map<string, string[]>();
        const incomingConnections = new Map<string, string[]>();

        for (const node of Object.values(graphState.nodes)) {
            outgoingConnections.set(node.id, []);
            incomingConnections.set(node.id, []);
        }

        for (const conn of Object.values(graphState.connections)) {
            outgoingConnections.get(conn.fromNodeId)?.push(conn.id);
            incomingConnections.get(conn.toNodeId)?.push(conn.id);
        }
        return { outgoingConnections, incomingConnections };
    }

    private applyMutations(state: AppState, mutations: AppMutation[]): void {
        for (const mutation of mutations) {
            switch (mutation.type) {
                case 'node.create':
                    state.graph.nodes[mutation.node.id] = mutation.node;
                    state.auxiliary.outgoingConnections.set(mutation.node.id, []);
                    state.auxiliary.incomingConnections.set(mutation.node.id, []);
                    break;
                case 'node.delete':
                    delete state.graph.nodes[mutation.node.id];
                    state.auxiliary.outgoingConnections.delete(mutation.node.id);
                    state.auxiliary.incomingConnections.delete(mutation.node.id);
                    break;
                case 'connection.create':
                    state.graph.connections[mutation.connection.id] = mutation.connection;
                    state.auxiliary.outgoingConnections.get(mutation.connection.fromNodeId)?.push(mutation.connection.id);
                    state.auxiliary.incomingConnections.get(mutation.connection.toNodeId)?.push(mutation.connection.id);
                    break;
                case 'connection.delete':
                    const conn = mutation.connection;
                    delete state.graph.connections[conn.id];
                    const outgoing = state.auxiliary.outgoingConnections.get(conn.fromNodeId);
                    if (outgoing) {
                        const index = outgoing.indexOf(conn.id);
                        if (index > -1) outgoing.splice(index, 1);
                    }
                    const incoming = state.auxiliary.incomingConnections.get(conn.toNodeId);
                    if (incoming) {
                        const index = incoming.indexOf(conn.id);
                        if (index > -1) incoming.splice(index, 1);
                    }
                    break;
                case 'node.move':
                    for (const move of mutation.moves) {
                        if (state.graph.nodes[move.nodeId]) {
                            state.graph.nodes[move.nodeId].x = move.to.x;
                            state.graph.nodes[move.nodeId].y = move.to.y;
                        }
                    }
                    break;
                case 'node.setConfig':
                    if (state.graph.nodes[mutation.nodeId]) {
                        Object.assign(state.graph.nodes[mutation.nodeId].config, mutation.to);
                    }
                    break;
                case 'selection.set':
                    state.selection = mutation.to;
                    break;
            }
        }
    }
    
    private applyMutationsToObservable(mutations: AppMutation[]): void {
        this.applyMutations(this.observableState, mutations);
    }

    private createInverse(mutations: AppMutation[]): AppMutation[] {
        const inverse: AppMutation[] = [];
        for (const m of mutations) {
            switch (m.type) {
                case 'node.create':
                    inverse.push({ type: 'node.delete', node: m.node });
                    break;
                case 'node.delete':
                    inverse.push({ type: 'node.create', node: m.node });
                    break;
                case 'connection.create':
                    inverse.push({ type: 'connection.delete', connection: m.connection });
                    break;
                case 'connection.delete':
                    inverse.push({ type: 'connection.create', connection: m.connection });
                    break;
                case 'node.move':
                    inverse.push({ type: 'node.move', moves: m.moves.map(move => ({ ...move, from: move.to, to: move.from })) });
                    break;
                case 'node.setConfig':
                    inverse.push({ type: 'node.setConfig', nodeId: m.nodeId, from: m.to, to: m.from });
                    break;
                case 'selection.set':
                    inverse.push({ type: 'selection.set', from: m.to, to: m.from });
                    break;
                default:
                    console.warn(`Inverse for mutation type ${(m as any).type} not implemented.`);
                    break;
            }
        }
        return inverse.reverse();
    }
}
