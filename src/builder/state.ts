import { observable, action, makeObservable, configure, computed, runInAction } from 'mobx';
import { produce, setAutoFreeze, enableMapSet } from 'immer';
import { HTMLTemplateResult } from 'lit';

// Enable Immer support for Map and Set
enableMapSet();

// Immer and MobX can have issues working together if Immer freezes the state.
// We disable auto-freezing to allow MobX to wrap the state objects.
setAutoFreeze(false);

// Enforce MobX strict mode
configure({
  enforceActions: "always",
  computedRequiresReaction: true,
  reactionRequiresObservable: false,
  observableRequiresReaction: false,
});

// Simple ID generator
const generateId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

// Part 1: Core Data Structures
export interface GridNode {
  id: string;
  x: number;
  y: number;
  config: {
    typeId: string;
    name?: string;
    values: {
      [portName: string]: number;
    };
    [key: string]: any;
  };
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

// The canonical, serializable state of the graph
export interface GraphInnerState {
  nodes: Record<string, GridNode>;
  connections: Record<string, Connection>;
}

// An editable graph, including the canonical graph and
// derived, non-serializable lookup maps for performance.
export interface GraphState {
  inner: GraphInnerState;
  auxiliary: {
    // map from a node ID to the IDs of its outgoing connections
    outgoingConnections: Map<string, string[]>;
    // map from a node ID to the IDs of its incoming connections
    incomingConnections: Map<string, string[]>;
  };
}

// The full application state, including the graph currently
// being edited.
export interface AppState {
  graph: GraphState;
}

// Part 2: Mutations
export type AppMutation =
  | { type: 'node.create', node: GridNode }
  | { type: 'node.delete', node: GridNode }
  | { type: 'node.move', moves: { nodeId: string, from: { x: number, y: number }, to: { x: number, y: number } }[] }
  | { type: 'node.setConfig', nodeId: string, from: Partial<any>, to: Partial<any> }
  | { type: 'connection.create', connection: Connection }
  | { type: 'connection.delete', connection: Connection }
  | { type: 'connection.setConfig', connectionId: string, from: Partial<any>, to: Partial<any> }
  | { type: 'connection.setPorts', connectionId: string, from: { fromPort?: string | number, toPort?: string | number }, to: { fromPort?: string | number, toPort?: string | number } };

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

  constructor(initialState?: GraphInnerState) {
    const graphState = initialState || { nodes: {}, connections: {} };
    this.currentState = {
      graph: {
        inner: graphState,
        auxiliary: this.buildAuxiliaryMaps(graphState),
      },
    };
    // MobX can make Maps and Sets observable directly
    this.observableState = observable(this.currentState);

    makeObservable(this, {
      observableState: observable,
      undoStack: observable,
      redoStack: observable,
      canUndo: computed,
      canRedo: computed,
    } as any);
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
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
      this.applyMutations(draft, mutations);
    });

    if (nextState !== this.currentState) {
      this.currentState = nextState;
      this.applyMutationsToObservable(mutations);

      if (!isUndoRedo) {
        const inverseMutations = this.createInverse(mutations);
        runInAction(() => {
          this.undoStack.push(inverseMutations);
          this.redoStack = [];
        });
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
      this.draftState.graph.auxiliary.incomingConnections = new Map(this.draftState.graph.auxiliary.incomingConnections);
      this.draftState.graph.auxiliary.outgoingConnections = new Map(this.draftState.graph.auxiliary.outgoingConnections);
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
      config: { typeId, values: {} },
    };
    this.dispatch([{ type: 'node.create', node: newNode }]);
    return newNode;
  }

  public deleteNode(nodeId: string): void {
    const state = this.getState();
    const nodeToDelete = state.graph.inner.nodes[nodeId];
    if (!nodeToDelete) return;

    const mutations: AppMutation[] = [];
    for (const conn of Object.values(state.graph.inner.connections)) {
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
    const connToDelete = this.getState().graph.inner.connections[connectionId];
    if (connToDelete) {
      this.dispatch([{ type: 'connection.delete', connection: connToDelete }]);
    }
  }

  public moveNodes(nodeIds: string[], dx: number, dy: number): void {
    const state = this.getState();
    const moves = nodeIds.map(id => {
      const node = state.graph.inner.nodes[id];
      return { nodeId: id, from: { x: node.x, y: node.y }, to: { x: node.x + dx, y: node.y + dy } };
    });
    this.dispatch([{ type: 'node.move', moves }]);
  }

  public insertSpace(axis: 'x' | 'y', afterIndex: number, amount: number = 1): void {
    const state = this.getState();
    const nodesToMove: string[] = [];

    for (const node of Object.values(state.graph.inner.nodes)) {
      if (axis === 'x' && node.x > afterIndex) {
        nodesToMove.push(node.id);
      } else if (axis === 'y' && node.y > afterIndex) {
        nodesToMove.push(node.id);
      }
    }

    if (nodesToMove.length > 0) {
      this.moveNodes(nodesToMove, axis === 'x' ? amount : 0, axis === 'y' ? amount : 0);
    }
  }

  public setNodeConfig(nodeId: string, configUpdate: Partial<GridNode['config']>): void {
    const state = this.getState();
    const fromConfig: Partial<any> = {};
    const currentNode = state.graph.inner.nodes[nodeId];
    for (const key in configUpdate) {
      if (Object.prototype.hasOwnProperty.call(configUpdate, key)) {
        fromConfig[key] = currentNode.config[key];
      }
    }
    this.dispatch([{ type: 'node.setConfig', nodeId, from: fromConfig, to: configUpdate }]);
  }

  public setConnectionPorts(connectionId: string, ports: { fromPort?: string | number, toPort?: string | number }): void {
    const state = this.getState();
    const connection = state.graph.inner.connections[connectionId];
    if (!connection) return;

    const from = { fromPort: connection.fromPort, toPort: connection.toPort };
    const to = { fromPort: ports.fromPort ?? connection.fromPort, toPort: ports.toPort ?? connection.toPort };

    this.dispatch([{ type: 'connection.setPorts', connectionId, from, to }]);
  }

  public setConnectionConfig(connectionId: string, configUpdate: Partial<any>): void { }

  public clear(): void {
    const state = this.getState();
    const mutations: AppMutation[] = [];

    // Delete all connections first
    for (const conn of Object.values(state.graph.inner.connections)) {
      mutations.push({ type: 'connection.delete', connection: conn });
    }

    // Delete all nodes
    for (const node of Object.values(state.graph.inner.nodes)) {
      mutations.push({ type: 'node.delete', node });
    }

    this.dispatch(mutations);
  }

  public loadGraph(graphState: GraphInnerState): void {
    this.clear();

    const mutations: AppMutation[] = [];

    // Recreate nodes
    for (const node of Object.values(graphState.nodes)) {
      mutations.push({ type: 'node.create', node });
    }

    // Recreate connections
    for (const conn of Object.values(graphState.connections)) {
      mutations.push({ type: 'connection.create', connection: conn });
    }

    this.dispatch(mutations);
    // Clear undo stack after loading a new graph
    runInAction(() => {
      this.undoStack = [];
      this.redoStack = [];
    });
  }

  public undo(): void {
    let mutationsToUndo: AppMutation[] | undefined;
    runInAction(() => {
      mutationsToUndo = this.undoStack.pop();
    });

    if (mutationsToUndo) {
      const redoMutations = this.createInverse(mutationsToUndo);
      runInAction(() => {
        this.redoStack.push(redoMutations);
      });
      this.dispatch(mutationsToUndo, true);
    }
  }

  public redo(): void {
    let mutationsToRedo: AppMutation[] | undefined;
    runInAction(() => {
      mutationsToRedo = this.redoStack.pop();
    });

    if (mutationsToRedo) {
      const undoMutations = this.createInverse(mutationsToRedo);
      runInAction(() => {
        this.undoStack.push(undoMutations);
      });
      this.dispatch(mutationsToRedo, true);
    }
  }

  private buildAuxiliaryMaps(graphState: GraphInnerState): GraphState['auxiliary'] {
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
          state.graph.inner.nodes[mutation.node.id] = mutation.node;
          state.graph.auxiliary.outgoingConnections.set(mutation.node.id, []);
          state.graph.auxiliary.incomingConnections.set(mutation.node.id, []);
          break;
        case 'node.delete':
          delete state.graph.inner.nodes[mutation.node.id];
          state.graph.auxiliary.outgoingConnections.delete(mutation.node.id);
          state.graph.auxiliary.incomingConnections.delete(mutation.node.id);
          break;
        case 'connection.create':
          state.graph.inner.connections[mutation.connection.id] = mutation.connection;
          state.graph.auxiliary.outgoingConnections.get(mutation.connection.fromNodeId)?.push(mutation.connection.id);
          state.graph.auxiliary.incomingConnections.get(mutation.connection.toNodeId)?.push(mutation.connection.id);
          break;
        case 'connection.delete':
          const conn = mutation.connection;
          delete state.graph.inner.connections[conn.id];
          const outgoing = state.graph.auxiliary.outgoingConnections.get(conn.fromNodeId);
          if (outgoing) {
            const index = outgoing.indexOf(conn.id);
            if (index > -1) outgoing.splice(index, 1);
          }
          const incoming = state.graph.auxiliary.incomingConnections.get(conn.toNodeId);
          if (incoming) {
            const index = incoming.indexOf(conn.id);
            if (index > -1) incoming.splice(index, 1);
          }
          break;
        case 'node.move':
          for (const move of mutation.moves) {
            if (state.graph.inner.nodes[move.nodeId]) {
              state.graph.inner.nodes[move.nodeId].x = move.to.x;
              state.graph.inner.nodes[move.nodeId].y = move.to.y;
            }
          }
          break;
        case 'node.setConfig':
          if (state.graph.inner.nodes[mutation.nodeId]) {
            state.graph.inner.nodes[mutation.nodeId].config = {
              ...state.graph.inner.nodes[mutation.nodeId].config,
              ...mutation.to,
            };
          }
          break;
        case 'connection.setPorts':
          if (state.graph.inner.connections[mutation.connectionId]) {
            if (mutation.to.fromPort !== undefined) {
              state.graph.inner.connections[mutation.connectionId].fromPort = mutation.to.fromPort;
            }
            if (mutation.to.toPort !== undefined) {
              state.graph.inner.connections[mutation.connectionId].toPort = mutation.to.toPort;
            }
          }
          break;
      }
    }
  }

  private applyMutationsToObservable(mutations: AppMutation[]): void {
    runInAction(() => {
      this.applyMutations(this.observableState, mutations);
    });
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
        case 'connection.setPorts':
          inverse.push({ type: 'connection.setPorts', connectionId: m.connectionId, from: m.to, to: m.from });
          break;
        default:
          console.warn(`Inverse for mutation type ${(m as any).type} not implemented.`);
          break;
      }
    }
    return inverse.reverse();
  }
}

// Part 4: Local Controller (UI State)
export interface LocalState {
  selection: Map<string, Selectable>;
  queuedSelection: Set<string>;
  inflightPortConnectionOperation: { nodeId: string, port: string, type: 'in' | 'out' } | null;
  loadedSubgraphs: Map<string, GraphState>;
}

export interface Selectable {
  path: string;
  renderInspectorContent?(): HTMLTemplateResult | undefined;
}

export interface SelectableHandle {
  select(): void;
}

export class LocalController {
  public observableState: LocalState;

  constructor() {
    this.observableState = observable({
      selection: new Map<string, Selectable>(),
      queuedSelection: new Set<string>(),
      inflightPortConnectionOperation: null,
      loadedSubgraphs: new Map<string, GraphState>(),
    });
    makeObservable(this);
  }

  public defineSelectable(selectable: Selectable): SelectableHandle {
    // If this path is in the queue, promote it to selection immediately
    if (this.observableState.queuedSelection.has(selectable.path)) {
      this.observableState.queuedSelection.delete(selectable.path);
      runInAction(() => {
        this.observableState.selection.set(selectable.path, selectable);
      });
    }

    // If this path is ALREADY selected, update the selectable instance
    // (e.g. if the component re-rendered with new data)
    if (this.observableState.selection.has(selectable.path)) {
      runInAction(() => {
        this.observableState.selection.set(selectable.path, selectable);
      });
    }

    return {
      select: action(() => {
        // Clear others if not additive?
        // For now, let's assume single select or we need an additive flag in the handle?
        // The handle.select() is usually called by a click handler which might have modifiers.
        // But here we are just defining the capability.
        // Let's keep it simple: select() replaces selection.
        this.observableState.selection.clear();
        this.observableState.selection.set(selectable.path, selectable);
      })
    };
  }

  @action
  public queueSelectPaths(paths: string[], additive: boolean = false): void {
    if (!additive) {
      this.observableState.selection.clear();
      this.observableState.queuedSelection.clear();
    }

    for (const path of paths) {
      // If we already have the selectable, select it directly
      if (this.observableState.selection.has(path)) {
        // It's already selected, do nothing (or update timestamp if we tracked that)
      } else {
        // Otherwise, queue it and wait for defineSelectable to claim it
        this.observableState.queuedSelection.add(path);
      }
    }
  }

  @action
  public setInflightPortConnectionOperation(port: { nodeId: string, port: string, type: 'in' | 'out' } | null): void {
    this.observableState.inflightPortConnectionOperation = port;
  }

  @action
  public loadSubgraph(id: string, graph: GraphState): void {
    this.observableState.loadedSubgraphs.set(id, graph);
  }
}
