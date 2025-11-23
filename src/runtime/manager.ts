import {
  makeObservable,
  observable,
  reaction,
  runInAction,
  when,
} from 'mobx';
import { AppController, AppState, LocalController } from '../builder/state';
import { compileGraph } from '../builder/compiler';
import { GraphExecutor } from '../structor/executor';
import { NodeRepository } from '../structor/repository';
import { ALL_PRIMITIVES } from '../structor/primitives';

export class RuntimeManager {
  @observable executor: GraphExecutor | null = null;
  @observable outputs = new Map<string, any>();
  @observable stats = {
    nodeCount: 0,
    executionTime: 0,
  };

  private nodeRepository = new NodeRepository(ALL_PRIMITIVES);

  constructor(
    private appController: AppController,
    private localController: LocalController
  ) {
    makeObservable(this);

    // This reaction will trigger a full recompile when the graph structure changes.
    reaction(
      () => this.getStructuralSignature(this.appController.getState()),
      () => {
        this.recompileAndRun();
      },
      { fireImmediately: true, delay: 50 } // Debounce structural changes
    );

    // This reaction handles configuration changes for existing nodes.
    reaction(
      () => this.getConfigSignature(this.appController.getState()),
      () => {
        if (this.executor) {
          const state = this.appController.getState();
          for (const node of Object.values(state.graph.inner.nodes)) {
            // This is a simplification. We would need to know which node changed.
            // A more robust implementation would get this from the mutation stream.
            // For now, we just update all configs.
            const { typeId, ...config } = node.config;
            this.executor.setNodeConfig(node.id, config);
          }
          this.runExecution();
        }
      },
      { delay: 50 } // Debounce config changes
    );
  }

  private getStructuralSignature(state: AppState): string {
    // A signature that changes only when nodes or connections are added/removed.
    const nodeIds = Object.keys(state.graph.inner.nodes).sort().join(',');
    const connIds = Object.keys(state.graph.inner.connections)
      .map(
        (id) =>
          `${state.graph.inner.connections[id].fromNodeId}->${state.graph.inner.connections[id].toNodeId}`
      )
      .sort()
      .join(',');
    return `${nodeIds}|${connIds}`;
  }

  private getConfigSignature(state: AppState): string {
    // A signature that changes when node configurations change.
    return JSON.stringify(
      Object.values(state.graph.inner.nodes).map((n) => n.config)
    );
  }

  private recompileAndRun() {
    console.log('Recompiling graph...');
    const state = this.appController.getState();
    const graphDef = compileGraph(
      state,
      this.localController.observableState.loadedSubgraphs
    );

    const newExecutor = new GraphExecutor(graphDef, this.nodeRepository);

    runInAction(() => {
      this.executor = newExecutor;
      this.runExecution();
    });
  }

  private runExecution() {
    if (!this.executor) {
      return;
    }

    const startTime = performance.now();
    this.executor.update();
    const endTime = performance.now();

    const newOutputs = this.executor.getOutputs();
    const newStats = {
      nodeCount: Object.keys(this.executor.graph.nodes).length,
      executionTime: endTime - startTime,
    };

    runInAction(() => {
      this.outputs.clear();
      for (const [key, value] of newOutputs.entries()) {
        // We only care about the untagged output for the debug view.
        this.outputs.set(key, value.untagged[0]);
      }
      this.stats = newStats;
    });

    console.log(`Execution finished in ${newStats.executionTime.toFixed(2)}ms`);
  }
}