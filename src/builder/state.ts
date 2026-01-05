import { observable, makeObservable, configure, computed, runInAction } from 'mobx';
import { produce, setAutoFreeze, enableMapSet } from 'immer';
import { StructorType } from '../structor/structor';
import { defaultNodeRepository as nodeRepository } from '../structor/repository';

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
export const generateId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

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
  inferredNodeTypes?: Record<string, { inputs: StructorType, outputs: StructorType }>;
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
  | { type: 'connection.setPorts', connectionId: string, from: { fromPort?: string | number, toPort?: string | number }, to: { fromPort?: string | number, toPort?: string | number } }
  | { type: 'graph.recompile' }
  | { type: 'graph.recompile' }
  | { type: 'graph.configUpdate', nodeIds: string[] }
  | { type: 'graph.inputUpdate', nodeId: string, inputs: Record<string, any> }
  | { type: 'graph.updateInferredTypes', inferredTypes: Record<string, { inputs: StructorType, outputs: StructorType }> };

export interface LongEditCallbacks {
  apply: (controller: AppController) => void;
  cancel?: () => void;
  accept?: () => void;
  complete?: () => void;
}

export class LongEdit {
  constructor(
    private controller: AppController,
    public callbacks: LongEditCallbacks
  ) { }

  public applyAgain(newApplyCallback?: (controller: AppController) => void) {
    if (newApplyCallback) {
      this.callbacks.apply = newApplyCallback;
    }
    this.controller.updateLongEdit(this);
  }

  public cancel() {
    this.controller.cancelLongEdit(this);
  }

  public accept() {
    this.controller.acceptLongEdit(this);
  }

  public get isActive() {
    return this.controller.activeLongEdit === this;
  }
}

// Helper to build auxiliary maps (lookup indices) from the canonical graph state
export function buildGraphStateAuxiliary(graphState: GraphInnerState): GraphState['auxiliary'] {
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

  // State for Long Edits
  public activeLongEdit: LongEdit | null = null;
  private longEditMutations: AppMutation[] = [];
  private isLongEditApplying: boolean = false;

  private compiledGraphDirtyListeners: (() => void)[] = [];
  private configChangeListeners: ((nodeIds: string[]) => void)[] = [];
  private inputUpdateListeners: ((updates: { nodeId: string, inputs: Record<string, any> }[]) => void)[] = [];
  private graphResetListeners: (() => void)[] = [];
  private inferredTypesUpdateListeners: ((inferredTypes: Record<string, any>) => void)[] = [];

  constructor(initialState?: GraphInnerState) {
    const graphState = initialState || { nodes: {}, connections: {} };
    this.currentState = {
      graph: {
        inner: graphState,
        auxiliary: buildGraphStateAuxiliary(graphState),
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

  public onCompiledGraphDirty(listener: () => void): () => void {
    this.compiledGraphDirtyListeners.push(listener);
    return () => {
      this.compiledGraphDirtyListeners = this.compiledGraphDirtyListeners.filter(l => l !== listener);
    };
  }

  public onConfigChange(listener: (nodeIds: string[]) => void): () => void {
    this.configChangeListeners.push(listener);
    return () => {
      this.configChangeListeners = this.configChangeListeners.filter(l => l !== listener);
    };
  }

  public onInputUpdate(listener: (updates: { nodeId: string, inputs: Record<string, any> }[]) => void): () => void {
    this.inputUpdateListeners.push(listener);
    return () => {
      this.inputUpdateListeners = this.inputUpdateListeners.filter(l => l !== listener);
    };
  }

  public onGraphReset(listener: () => void): () => void {
    this.graphResetListeners.push(listener);
    return () => {
      this.graphResetListeners = this.graphResetListeners.filter(l => l !== listener);
    };
  }

  public onInferredTypesUpdate(listener: (inferredTypes: Record<string, any>) => void): () => void {
    this.inferredTypesUpdateListeners.push(listener);
    return () => {
      this.inferredTypesUpdateListeners = this.inferredTypesUpdateListeners.filter(l => l !== listener);
    };
  }

  public dispatch(mutations: AppMutation[], isUndoRedo: boolean = false): void {
    if (mutations.length === 0) return;

    if (this.isTransactionActive) {
      this.bufferedMutations.push(...mutations);
      this.applyMutations(this.draftState!, mutations);
      return;
    }

    if (this.isLongEditApplying) {
      // We are inside a long edit apply callback.
      // Apply to observable state only.
      this.applyMutationsToObservable(mutations);
      this.longEditMutations.push(...mutations);
      // Notify listeners even during long edit application so UI/Audio updates
      this.notifyListeners(mutations);
      return;
    }

    // If we have an active long edit, we need to interleave.
    if (this.activeLongEdit) {
      // 1. Revert long edit from observable
      if (this.longEditMutations.length > 0) {
        const inverse = this.createInverse(this.longEditMutations);
        this.applyMutationsToObservable(inverse);
      }

      // 2. Apply short edit to currentState (and observable)
      const nextState = produce(this.currentState, draft => {
        this.applyMutations(draft, mutations);
      });

      if (nextState !== this.currentState) {
        this.currentState = nextState;
        this.applyMutationsToObservable(mutations);

        if (!isUndoRedo) {
          const mutationsForHistory = mutations.filter(m => m.type !== 'graph.updateInferredTypes');
          if (mutationsForHistory.length > 0) {
            const inverseMutations = this.createInverse(mutationsForHistory);
            runInAction(() => {
              this.undoStack.push(inverseMutations);
              this.redoStack = [];
            });
          }
        }
      }

      // 3. Re-apply long edit
      // We need to clear the old mutations list because we are going to regenerate them.
      this.longEditMutations = [];

      this.isLongEditApplying = true;
      try {
        this.activeLongEdit.callbacks.apply(this);
      } finally {
        this.isLongEditApplying = false;
      }

      // Always notify listeners, even if state didn't change (e.g. signals)
      this.notifyListeners(mutations);

      return;
    }

    const nextState = produce(this.currentState, draft => {
      this.applyMutations(draft, mutations);
    });

    if (nextState !== this.currentState) {
      this.currentState = nextState;
      this.applyMutationsToObservable(mutations);

      if (!isUndoRedo) {
        // Filter out mutations that shouldn't be in history
        const mutationsForHistory = mutations.filter(m => m.type !== 'graph.updateInferredTypes');

        if (mutationsForHistory.length > 0) {
          const inverseMutations = this.createInverse(mutationsForHistory);
          runInAction(() => {
            this.undoStack.push(inverseMutations);
            this.redoStack = [];
          });
        }
      }
    }

    // Always notify listeners, even if state didn't change (e.g. signals)
    this.notifyListeners(mutations);
  }

  private notifyListeners(mutations: AppMutation[]) {
    let needsRecompile = false;
    const configUpdateNodeIds = new Set<string>();
    const inputUpdates: { nodeId: string, inputs: Record<string, any> }[] = [];

    for (const mutation of mutations) {
      switch (mutation.type) {
        case 'node.create':
        case 'node.delete':
        case 'connection.create':
        case 'connection.delete':
        case 'connection.setPorts':
        case 'graph.recompile':
          needsRecompile = true;
          break;
        case 'graph.configUpdate':
          mutation.nodeIds.forEach(id => configUpdateNodeIds.add(id));
          break;
        case 'graph.inputUpdate':
          inputUpdates.push({ nodeId: mutation.nodeId, inputs: mutation.inputs });
          break;
        case 'node.setConfig':
          // Check if only values changed
          const keys = Object.keys(mutation.to);
          if (keys.length === 1 && keys[0] === 'values' && mutation.to.values) {
            inputUpdates.push({ nodeId: mutation.nodeId, inputs: mutation.to.values });
          } else if (mutation.to.typeId) {
            // If typeId changed, we MUST recompile because the node definition changed
            needsRecompile = true;
          } else {
            configUpdateNodeIds.add(mutation.nodeId);
          }
          break;
        case 'node.move':
          // Smart Spatial Recompilation
          if (!needsRecompile) {
            const state = this.currentState.graph.inner;
            const regionNodes = Object.values(state.nodes).filter(n => {
              const def = nodeRepository.get(n.config.typeId);
              return def && (def as any).getRegion;
            });

            if (regionNodes.length > 0) {
              for (const move of mutation.moves) {
                // 1. Check if the moved node changed Parents
                const getParent = (x: number, y: number): string | null => {
                  for (const region of regionNodes) {
                    if (region.id === move.nodeId) continue; // Provide sanity check
                    const def = nodeRepository.get(region.config.typeId) as any;
                    const r = def.getRegion(region.config);
                    // Absolute region bounds
                    const rx1 = region.x + r.x;
                    const ry1 = region.y + r.y;
                    const rx2 = rx1 + r.width;
                    const ry2 = ry1 + r.height;

                    if (x >= rx1 && x < rx2 && y >= ry1 && y < ry2) {
                      return region.id;
                    }
                  }
                  return null;
                };

                const oldParent = getParent(move.from.x, move.from.y);
                const newParent = getParent(move.to.x, move.to.y);

                if (oldParent !== newParent) {
                  needsRecompile = true;
                  break;
                }

                // 2. Check if the moved node IS a region and swept over children
                const nodeDef = nodeRepository.get(state.nodes[move.nodeId]?.config.typeId) as any;
                if (nodeDef && nodeDef.getRegion) {
                  // This is expensive (O(N)), but necessary for Region moves.
                  // Check if the set of children changed.
                  const r = nodeDef.getRegion(state.nodes[move.nodeId].config);

                  // Helper to check if a node is in a rect
                  const isIn = (nx: number, ny: number, rx: number, ry: number) => {
                    return nx >= rx && nx < rx + r.width && ny >= ry && ny < ry + r.height;
                  };

                  for (const other of Object.values(state.nodes)) {
                    if (other.id === move.nodeId) continue;

                    const wasIn = isIn(other.x, other.y, move.from.x + r.x, move.from.y + r.y);
                    const isInNow = isIn(other.x, other.y, move.to.x + r.x, move.to.y + r.y);

                    if (wasIn !== isInNow) {
                      needsRecompile = true;
                      break;
                    }
                  }
                }

                if (needsRecompile) break;
              }
            }
          }
          break;
      }
    }

    if (needsRecompile) {
      for (const listener of this.compiledGraphDirtyListeners) {
        try { listener(); } catch (e) { console.error(e); }
      }
    }

    if (configUpdateNodeIds.size > 0) {
      const nodeIds = Array.from(configUpdateNodeIds);
      for (const listener of this.configChangeListeners) {
        try { listener(nodeIds); } catch (e) { console.error(e); }
      }
    }

    if (inputUpdates.length > 0) {
      for (const listener of this.inputUpdateListeners) {
        try { listener(inputUpdates); } catch (e) { console.error(e); }
      }
    }

    for (const mutation of mutations) {
      if (mutation.type === 'graph.updateInferredTypes') {
        for (const listener of this.inferredTypesUpdateListeners) {
          try { listener(mutation.inferredTypes); } catch (e) { console.error(e); }
        }
        break;
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

  public beginLongEdit(callbacks: LongEditCallbacks): LongEdit {
    if (this.activeLongEdit) {
      this.activeLongEdit.cancel();
    }

    const edit = new LongEdit(this, callbacks);
    this.activeLongEdit = edit;

    // Initial apply
    this.updateLongEdit(edit);

    return edit;
  }

  public updateLongEdit(edit: LongEdit) {
    if (this.activeLongEdit !== edit) return;

    // Revert previous long edit mutations from observable state
    if (this.longEditMutations.length > 0) {
      const inverse = this.createInverse(this.longEditMutations);
      this.applyMutationsToObservable(inverse);
      this.longEditMutations = [];
    }

    // Apply new changes
    this.isLongEditApplying = true;
    try {
      edit.callbacks.apply(this);
    } finally {
      this.isLongEditApplying = false;
    }
  }

  public cancelLongEdit(edit: LongEdit) {
    if (this.activeLongEdit !== edit) return;

    // Revert mutations
    if (this.longEditMutations.length > 0) {
      const inverse = this.createInverse(this.longEditMutations);
      this.applyMutationsToObservable(inverse);
      this.longEditMutations = [];
    }

    this.activeLongEdit = null;
    if (edit.callbacks.cancel) edit.callbacks.cancel();
    if (edit.callbacks.complete) edit.callbacks.complete();
  }

  public acceptLongEdit(edit: LongEdit) {
    if (this.activeLongEdit !== edit) return;

    // We have the mutations in this.longEditMutations.
    // They are already applied to observableState.
    // We need to apply them to currentState and push to undoStack.

    const mutations = [...this.longEditMutations];

    // Apply to currentState
    const nextState = produce(this.currentState, draft => {
      this.applyMutations(draft, mutations);
    });
    this.currentState = nextState;

    // Push to undo stack
    const inverseMutations = this.createInverse(mutations);
    runInAction(() => {
      this.undoStack.push(inverseMutations);
      this.redoStack = [];
    });

    this.activeLongEdit = null;
    this.longEditMutations = [];

    if (edit.callbacks.accept) edit.callbacks.accept();
    if (edit.callbacks.complete) edit.callbacks.complete();
  }

  public createNode(typeId: string, x: number, y: number, initialConfig?: Partial<GridNode['config']> & { id?: string }): GridNode {
    const id = initialConfig?.id || generateId('node');
    // Remove id from config to avoid storing it twice if passed
    const { id: _, ...restConfig } = initialConfig || {};

    const newNode: GridNode = {
      id,
      x,
      y,
      config: { typeId, name: '#', values: {}, ...restConfig },
    };
    this.dispatch([{ type: 'node.create', node: newNode }, { type: 'graph.recompile' }]);
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
    mutations.push({ type: 'graph.recompile' });
    this.dispatch(mutations);
  }

  public createConnection(fromNodeId: string, fromPort: string | number, toNodeId: string, toPort: string | number): Connection {
    const newConnection: Connection = { id: generateId('conn'), fromNodeId, fromPort, toNodeId, toPort };
    this.dispatch([{ type: 'connection.create', connection: newConnection }, { type: 'graph.recompile' }]);
    return newConnection;
  }

  public deleteConnection(connectionId: string): void {
    const connToDelete = this.getState().graph.inner.connections[connectionId];
    if (connToDelete) {
      this.dispatch([{ type: 'connection.delete', connection: connToDelete }, { type: 'graph.recompile' }]);
    }
  }

  public duplicateNodes(nodeIds: string[], offset: { x: number, y: number } = { x: 0, y: 0 }): string[] {
    const state = this.getState();
    const newIds: string[] = [];
    const idMap = new Map<string, string>(); // Old ID -> New ID

    const mutations: AppMutation[] = [];

    // 1. Create Copies
    for (const id of nodeIds) {
      const originalNode = state.graph.inner.nodes[id];
      if (!originalNode) continue;

      const newId = generateId('node');
      newIds.push(newId);
      idMap.set(id, newId);

      const newNode: GridNode = {
        ...originalNode,
        id: newId,
        x: originalNode.x + offset.x,
        y: originalNode.y + offset.y,
        config: JSON.parse(JSON.stringify(originalNode.config)) // Deep copy config
      };

      mutations.push({ type: 'node.create', node: newNode });
    }

    // 2. Duplicate Internal Connections
    // Only copy connections where BOTH ends are within the duplicated set
    const internalConnections = Object.values(state.graph.inner.connections).filter(conn =>
      nodeIds.includes(conn.fromNodeId) && nodeIds.includes(conn.toNodeId)
    );

    for (const conn of internalConnections) {
      const newFromId = idMap.get(conn.fromNodeId);
      const newToId = idMap.get(conn.toNodeId);

      if (newFromId && newToId) {
        const newConnection: Connection = {
          id: generateId('conn'),
          fromNodeId: newFromId,
          fromPort: conn.fromPort,
          toNodeId: newToId,
          toPort: conn.toPort
        };
        mutations.push({ type: 'connection.create', connection: newConnection });
      }
    }

    if (mutations.length > 0) {
      mutations.push({ type: 'graph.recompile' });
      this.dispatch(mutations);
    }

    return newIds;
  }

  public calculateConstrainedMove(nodeIds: string[], dx: number, dy: number): { dx: number, dy: number } {
    const state = this.getState();
    let constrainedDx = dx;
    let constrainedDy = dy;

    const nodes = nodeIds.map(id => state.graph.inner.nodes[id]).filter(n => !!n);

    // Check for pinned nodes
    const hasPinned = nodes.some(n => n.config.typeId === 'io.input' || n.config.typeId === 'io.output');

    if (hasPinned) {
      constrainedDx = 0; // Lock X axis for pinned nodes
    } else {
      // Enforce boundaries for normal nodes (1 <= x <= 50)
      for (const n of nodes) {
        const newX = n.x + constrainedDx;
        if (newX < 0) {
          constrainedDx = 0 - n.x;
        } else if (newX > 50) {
          constrainedDx = 50 - n.x;
        }
      }
    }

    return { dx: constrainedDx, dy: constrainedDy };
  }

  public moveNodes(nodeIds: string[], dx: number, dy: number): void {
    const state = this.getState();
    const finalMoves = new Map<string, { from: { x: number, y: number }, to: { x: number, y: number } }>();
    const processingQueue: { id: string, dx: number, dy: number }[] = [];

    // Initial moves
    for (const id of nodeIds) {
      if (state.graph.inner.nodes[id]) {
        processingQueue.push({ id, dx, dy });
      }
    }

    // Process queue to propagate moves
    // We limit iterations to avoid infinite loops in pathological cases
    let iterations = 0;
    while (processingQueue.length > 0 && iterations < 1000) {
      const current = processingQueue.shift()!;
      iterations++;

      if (finalMoves.has(current.id)) continue; // Already moved this node in this batch?
      // Actually, if a node is pushed multiple times, we should accumulate?
      // Simpler approach: Calculate final position for everything.

      const node = state.graph.inner.nodes[current.id];
      if (!node) continue;

      const from = { x: node.x, y: node.y };
      const to = { x: node.x + current.dx, y: node.y + current.dy };

      finalMoves.set(current.id, { nodeId: current.id, from, to } as any);

      // Check for collisions at the new position
      // For simplicity, we just check if any OTHER node is at 'to.x, to.y'
      // This assumes 1x1 grid cells which simplifies things greatly.
      // GraphGrid actually renders nodes larger, but let's see if we track grid occupation.
      // The prompt implies we should "make space".
      // If we move A to (1,1) and B is at (1,1), we should move B.

      // Determine direction of push for chain reaction
      // If we are moving X, push X. If Y, push Y.
      // If both? prioritize dominant or just push same vector.

      for (const otherNode of Object.values(state.graph.inner.nodes)) {
        if (otherNode.id === current.id) continue;
        if (finalMoves.has(otherNode.id)) {
          // If the other node is ALSO moving efficiently, we check its DESTINATION?
          // This gets complex.
          // Let's rely on looking up current state + planned moves.
          continue;
        }

        // Is otherNode at the target position?
        // Note: We need to handle multi-cell nodes eventually, but GraphGrid logic suggests
        // nodes have x,y integers.
        if (otherNode.x === to.x && otherNode.y === to.y) {
          // Collision! Push otherNode
          // If we inserted `current` into `to`, `otherNode` needs to move.
          // We move it by the same delta to preserve relative structure?
          // Or just bump it by 1?
          // "Make space" usually means shifting.
          // Let's propagate the same dx, dy.

          // But what if dx=0, dy=0? (Shouldn't happen in queue)
          // What if we swap?

          // Let's try pushing by the same amount.
          processingQueue.push({ id: otherNode.id, dx: current.dx, dy: current.dy });
        }
      }
    }

    // Convert map to array
    const moves = Array.from(finalMoves.values()).map((m: any) => ({
      nodeId: m.nodeId,
      from: m.from,
      to: m.to
    }));

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

  public setNodeConfig(nodeId: string, configUpdate: Partial<GridNode['config']>, options: { skipHistory?: boolean } = {}): void {
    const state = this.getState();
    const fromConfig: Partial<any> = {};
    const toConfig: Partial<any> = {};
    const currentNode = state.graph.inner.nodes[nodeId] as GridNode | undefined;

    if (currentNode) {
      for (const key in configUpdate) {
        if (Object.prototype.hasOwnProperty.call(configUpdate, key)) {
          const newValue = configUpdate[key];
          const oldValue = currentNode.config[key];

          // Simple strict equality check
          // For complex objects/arrays, we might trigger update anyway, which is safe.
          // But for primitives like typeId (string), this prevents redundant updates.
          if (newValue !== oldValue) {
            fromConfig[key] = oldValue;
            toConfig[key] = newValue;
          }
        }
      }
    }

    if (Object.keys(toConfig).length > 0) {
      // dispatch takes isUndoRedo as second arg. If skipHistory is true, we treat it as "don't push to stack" which isUndoRedo=true achieves.
      this.dispatch([{ type: 'node.setConfig', nodeId, from: fromConfig, to: toConfig }], options.skipHistory);
    }
  }

  public setConnectionPorts(connectionId: string, ports: { fromPort?: string | number, toPort?: string | number }): void {
    const state = this.getState();
    const connection = state.graph.inner.connections[connectionId];
    if (!connection) return;

    const from = { fromPort: connection.fromPort, toPort: connection.toPort };
    const to = { fromPort: ports.fromPort ?? connection.fromPort, toPort: ports.toPort ?? connection.toPort };

    this.dispatch([{ type: 'connection.setPorts', connectionId, from, to }, { type: 'graph.recompile' }]);
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

    mutations.push({ type: 'graph.recompile' });
    this.dispatch(mutations);

    // Notify reset listeners
    for (const listener of this.graphResetListeners) {
      try { listener(); } catch (e) { console.error(e); }
    }
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

    mutations.push({ type: 'graph.recompile' });

    if (graphState.inferredNodeTypes) {
      mutations.push({
        type: 'graph.updateInferredTypes',
        inferredTypes: graphState.inferredNodeTypes
      });
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
          if (state.graph.inner.inferredNodeTypes) {
            delete state.graph.inner.inferredNodeTypes[mutation.node.id];
          }
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
        case 'graph.recompile':
          // No state change, just a signal
          break;
        case 'graph.configUpdate':
          // No state change, just a signal
          break;
        case 'graph.inputUpdate':
          // No state change, just a signal
          break;
        case 'graph.updateInferredTypes':
          // Correctly replace the map instead of merging stale keys
          state.graph.inner.inferredNodeTypes = mutation.inferredTypes;
          break;
          // No state change, just a signal
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
        case 'connection.setConfig':
          inverse.push({ type: 'connection.setConfig', connectionId: m.connectionId, from: m.to, to: m.from });
          break;
        case 'graph.recompile':
          inverse.push({ type: 'graph.recompile' });
          break;
        case 'graph.configUpdate':
          inverse.push({ type: 'graph.configUpdate', nodeIds: m.nodeIds });
          break;
        case 'graph.inputUpdate':
          const configMutation = mutations.find(m => m.type === 'node.setConfig' && m.nodeId === m.nodeId) as any;
          if (configMutation && configMutation.from && configMutation.from.values) {
            inverse.push({ type: 'graph.inputUpdate', nodeId: m.nodeId, inputs: configMutation.from.values });
          } else {
            // Fallback or ignore?
            // If we can't find values, maybe just `graph.configUpdate`?
            inverse.push({ type: 'graph.configUpdate', nodeIds: [m.nodeId] });
          }
          break;
        default:
          console.warn(`Inverse for mutation type ${(m as any).type} not implemented.`);
          break;
      }
    }
    return inverse.reverse();
  }
}
