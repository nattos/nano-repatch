import { observable, action, makeObservable, configure } from 'mobx';
import { produce, setAutoFreeze } from 'immer';

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
    typeId: string;
    x: number;
    y: number;
    config: any;
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

export interface AppState {
    nodes: Record<string, GridNode>;
    connections: Record<string, Connection>;
}

// Part 2: Mutations
export type AppMutation =
    | { type: 'node.create', node: GridNode }
    | { type: 'node.delete', node: GridNode }
    | { type: 'node.move', moves: { nodeId: string, from: {x: number, y: number}, to: {x: number, y: number} }[] }
    | { type: 'node.setConfig', nodeId: string, from: Partial<any>, to: Partial<any> }
    | { type: 'connection.create', connection: Connection }
    | { type: 'connection.delete', connection: Connection }
    | { type: 'connection.setConfig', connectionId: string, from: Partial<any>, to: Partial<any> };

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

    constructor(initialState?: AppState) {
        this.currentState = initialState || { nodes: {}, connections: {} };
        this.observableState = observable(JSON.parse(JSON.stringify(this.currentState)));
        
        makeObservable(this, {
            observableState: observable,
            applyMutationsToObservable: action,
        });
    }

    public getState(): Readonly<AppState> {
        // If inside a transaction, return the draft state so changes are readable.
        return this.isTransactionActive && this.draftState ? this.draftState : this.currentState;
    }

    public dispatch(mutations: AppMutation[], isUndoRedo: boolean = false): void {
        if (mutations.length === 0) return;

        // If a transaction is active, buffer the mutations instead of dispatching immediately.
        if (this.isTransactionActive) {
            this.bufferedMutations.push(...mutations);
            // Apply mutations to the draft state for in-transaction reads.
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
        // Start transaction
        this.isTransactionActive = true;
        this.bufferedMutations = [];
        // The draft state is a mutable copy for this transaction
        this.draftState = JSON.parse(JSON.stringify(this.currentState));

        try {
            callback(this);

            // If callback completes, commit the transaction
            const mutationsToDispatch = [...this.bufferedMutations];
            this.isTransactionActive = false;
            this.bufferedMutations = [];
            this.draftState = null;
            
            this.dispatch(mutationsToDispatch);

        } catch (e) {
            // If anything goes wrong, discard the transaction
            this.isTransactionActive = false;
            this.bufferedMutations = [];
            this.draftState = null;
            throw e; // Re-throw the error
        }
    }

    public createNode(typeId: string, x: number, y: number): GridNode {
        const newNode: GridNode = { id: generateId('node'), typeId, x, y, config: {} };
        this.dispatch([{ type: 'node.create', node: newNode }]);
        return newNode;
    }

    public deleteNode(nodeId: string): void {
        const state = this.getState(); // Use getState to read from draft if in transaction
        const nodeToDelete = state.nodes[nodeId];
        if (!nodeToDelete) return;

        const mutations: AppMutation[] = [];
        for (const conn of Object.values(state.connections)) {
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
        const connToDelete = this.getState().connections[connectionId];
        if (connToDelete) {
            this.dispatch([{ type: 'connection.delete', connection: connToDelete }]);
        }
    }

    public moveNodes(nodeIds: string[], dx: number, dy: number): void {
        const state = this.getState();
        const moves = nodeIds.map(id => {
            const node = state.nodes[id];
            return { nodeId: id, from: { x: node.x, y: node.y }, to: { x: node.x + dx, y: node.y + dy } };
        });
        this.dispatch([{ type: 'node.move', moves }]);
    }

    public setNodeConfig(nodeId: string, configUpdate: Partial<any>): void {
        const state = this.getState();
        const fromConfig: Partial<any> = {};
        const currentNode = state.nodes[nodeId];
        for (const key in configUpdate) {
            if (Object.prototype.hasOwnProperty.call(configUpdate, key)) {
                fromConfig[key] = currentNode.config[key];
            }
        }
        this.dispatch([{ type: 'node.setConfig', nodeId, from: fromConfig, to: configUpdate }]);
    }

    public setConnectionConfig(connectionId: string, configUpdate: Partial<any>): void {}
    
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

    private applyMutations(state: AppState, mutations: AppMutation[]): void {
        for (const mutation of mutations) {
            switch (mutation.type) {
                case 'node.create':
                    state.nodes[mutation.node.id] = mutation.node;
                    break;
                case 'node.delete':
                    delete state.nodes[mutation.node.id];
                    break;
                case 'connection.create':
                    state.connections[mutation.connection.id] = mutation.connection;
                    break;
                case 'connection.delete':
                    delete state.connections[mutation.connection.id];
                    break;
                case 'node.move':
                    for (const move of mutation.moves) {
                        if (state.nodes[move.nodeId]) {
                            state.nodes[move.nodeId].x = move.to.x;
                            state.nodes[move.nodeId].y = move.to.y;
                        }
                    }
                    break;
                case 'node.setConfig':
                    if (state.nodes[mutation.nodeId]) {
                        Object.assign(state.nodes[mutation.nodeId].config, mutation.to);
                    }
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
                default:
                    console.warn(`Inverse for mutation type ${(m as any).type} not implemented.`);
                    break;
            }
        }
        return inverse.reverse();
    }
}