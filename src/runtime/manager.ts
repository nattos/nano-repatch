import { makeAutoObservable, autorun, runInAction } from 'mobx';
import { appController, localController } from '../builder/controllers';
import { compileGraph } from '../builder/compiler';
import { GraphExecutor } from '../structor/executor';
import { defaultNodeRepository } from '../structor/repository';
import { GraphDefinition } from '../structor/structor';

export class RuntimeManager {
  public executor: GraphExecutor | null = null;
  public outputs = new Map<string, any>();
  public stats = { nodeCount: 0 };

  constructor() {
    makeAutoObservable(this);
    this.start();
  }

  private start() {
    autorun(() => {
      const appState = appController.observableState;
      const loadedSubgraphs = localController.observableState.loadedSubgraphs;

      // Compile the graph
      // This will track dependencies on appState and loadedSubgraphs
      const graphDef = compileGraph(appState, loadedSubgraphs);

      this.handleUpdate(graphDef);
    });
  }

  private handleUpdate(newGraph: GraphDefinition) {
    runInAction(() => {
      // Check if we need to recreate the executor
      if (!this.executor || this.hasStructureChanged(this.executor['graph'], newGraph)) {
        // Recreate
        this.executor = new GraphExecutor(newGraph, defaultNodeRepository);
      } else {
        // Update Configs
        for (const [nodeId, instance] of Object.entries(newGraph.nodes)) {
          const currentConfig = this.executor.getNodeConfig(nodeId);
          // Simple equality check for config (assuming it's a primitive or simple object)
          // In a real app, we might need deep comparison or rely on immutable references.
          // Since compileGraph creates new objects, reference equality fails.
          // Let's use JSON stringify for now as a cheap deep equal for small configs.
          if (instance.defaultConfig !== undefined && JSON.stringify(currentConfig) !== JSON.stringify(instance.defaultConfig)) {
            this.executor.setNodeConfig(nodeId, instance.defaultConfig);
          }
        }
      }

      // Execute
      this.executor.update();

      // Update Outputs and Stats
      this.outputs.clear();
      // We need to expose a way to get all node outputs from executor
      // GraphExecutor doesn't expose all states publicly, but we can access them if we change visibility
      // or add a method. For now, let's assume we can iterate or we add a method.
      // Let's cast to any to access private nodeStates for debugging/overlay
      const states = (this.executor as any).nodeStates;
      if (states) {
        let executedCount = 0;
        for (const [nodeId, state] of states.entries()) {
          // We want to show the output value.
          // state.output is a StructorRecord.
          // We probably want to show the '0' output or the whole record.
          // Let's show the whole record for now.
          this.outputs.set(nodeId, state.output);

          // Count executed nodes (dirty was false after update, but we don't track "was executed")
          // Actually, executor doesn't expose "nodes executed in last update".
          // We can approximate or add a metric to executor.
          // For now, let's just count total nodes.
          executedCount++;
        }
        this.stats.nodeCount = executedCount;
      }
    });
  }

  private hasStructureChanged(oldGraph: GraphDefinition, newGraph: GraphDefinition): boolean {
    // 1. Compare Connections
    if (oldGraph.connections.length !== newGraph.connections.length) return true;
    // We assume order might be stable from compiler, but let's be safe?
    // JSON stringify is fast enough for this scale.
    if (JSON.stringify(oldGraph.connections) !== JSON.stringify(newGraph.connections)) return true;

    // 2. Compare Nodes (Keys and Definitions)
    const oldKeys = Object.keys(oldGraph.nodes).sort();
    const newKeys = Object.keys(newGraph.nodes).sort();
    if (JSON.stringify(oldKeys) !== JSON.stringify(newKeys)) return true;

    for (const key of oldKeys) {
      if (oldGraph.nodes[key].definitionId !== newGraph.nodes[key].definitionId) return true;
    }

    return false;
  }
}

export const runtimeManager = new RuntimeManager();
// Expose for testing
(window as any).runtimeManager = runtimeManager;
