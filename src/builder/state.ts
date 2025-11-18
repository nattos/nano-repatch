import { observable, action, makeObservable } from 'mobx';

// Part 1: Core Data Structures
export interface GridNode {
    id: string;
    typeId: string;
    x: number;
    y: number;
    config: any;
}

export interface Connection {
    id: string;
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
    // Omitting space.make and space.compress for now

// Part 3: The Controller (`AppController`)
//
// The `AppController` is the single entry point for all state modifications.
// It orchestrates the process of applying mutations, updating the immutable
// state, updating the observable UI state, and managing the undo/redo history.
//
// --- Advanced Use Case: Speculative Edits & Verification ---
//
// The transaction system is designed to be powerful enough to support
// "speculative" edits. A tool or user action can start a transaction,
// make a change, and then—within the same transaction—run analysis on the
// resulting draft state.
//
// For example, when creating a new connection:
// 1. A transaction is started.
// 2. A `connection.create` operation is performed.
// 3. The controller can then, using the draft state, generate a `GraphDefinition`.
// 4. This definition is passed to a static analysis engine.
// 5. If the analysis reveals a type error, the transaction could be aborted,
//    or a different, corrective action could be taken.
// 6. If the analysis succeeds, the transaction is committed.
//
// This allows for the creation of smart, responsive tools that can provide
// immediate feedback and prevent the user from creating invalid graph states.
// It relies on the ability to read the "draft" state mid-transaction.
//
// ===================================================================

export class AppController {
    private currentState: AppState;
    
    // For now, the observable state is just a direct copy.
    // In a real implementation, this would be a deep, readonly mobx object.
    public observableState: AppState;

    private undoStack: AppMutation[][] = [];
    private redoStack: AppMutation[][] = [];

    constructor(initialState?: AppState) {
        this.currentState = initialState || { nodes: {}, connections: {} };
        this.observableState = this.currentState; // Simplified for now
    }

    public getState(): Readonly<AppState> {
        return this.currentState;
    }

    public dispatch(mutations: AppMutation[], isUndoRedo: boolean = false): void {
        // This will be implemented using immer
    }

    public transaction(callback: (draftController: this) => void): void {
        // This will be implemented to buffer mutations and apply them atomically.
        // It will manage a draft state for the callback to read from.
    }

    // Action methods now return the created/modified object or its ID to be used
    // within the same transaction.
    public createNode(typeId: string, x: number, y: number): GridNode {
        // To be implemented
        return {} as GridNode;
    }

    public moveNodes(nodeIds: string[], dx: number, dy: number): void {
        // To be implemented
    }

    public deleteNode(nodeId: string): void {
        // To be implemented
    }

    public setNodeConfig(nodeId: string, configUpdate: Partial<any>): void {
        // To be implemented
    }

    public createConnection(fromNodeId: string, fromPort: string | number, toNodeId: string, toPort: string | number): Connection {
        // To be implemented
        return {} as Connection;
    }

    public deleteConnection(connectionId: string): void {
        // To be implemented
    }

    public setConnectionConfig(connectionId: string, configUpdate: Partial<any>): void {
        // To be implemented
    }

    public undo(): void {
        // To be implemented
    }

    public redo(): void {
        // To be implemented
    }

    private applyMutations(state: AppState, mutations: AppMutation[]): void {
        // To be implemented
    }

    private createInverse(mutations: AppMutation[]): AppMutation[] {
        return []; // To be implemented
    }
}