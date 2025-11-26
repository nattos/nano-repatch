import {
  makeObservable,
  observable,
  reaction,
  runInAction,
} from 'mobx';
import { AppController, AppState, LocalController } from '../builder/state';
import { compileGraph } from '../builder/compiler';
import { GraphExecutor } from '../structor/executor';
import { defaultNodeRepository } from '../structor/repository';
import { PrimitiveNodeDefinition } from '../structor/structor';

const FRAME_RATE = 60;

export class RuntimeManager {
  @observable executor: GraphExecutor | null = null;
  @observable outputs = new Map<string, any>();
  @observable stats = {
    nodeCount: 0,
    executionTime: 0,
  };
  @observable isRealtimeGraph = false;

  private nodeRepository = defaultNodeRepository;
  private realtimeNodeCache = new Map<string, boolean>();
  private animationFrameId: number | null = null;
  private clock = { beat: 0 };

  constructor(
    private appController: AppController,
    private localController: LocalController
  ) {
    makeObservable(this);

    // This reaction will trigger a full recompile when the graph structure changes.
    reaction(
      () => this.getStructuralSignature(this.appController.observableState),
      () => {
        this.recompileAndRun();
      },
      { fireImmediately: true, delay: 50 } // Debounce structural changes
    );

    // This reaction handles configuration changes for existing nodes.
    reaction(
      () => this.getConfigSignature(this.appController.observableState),
      () => {
        this.updateNodeConfigsAndRealtimeStatus();
        // If not in realtime mode, run execution once.
        // In realtime mode, the loop is responsible for execution.
        if (!this.isRealtimeGraph) {
          this.runExecution();
        }
      },
      { delay: 50 } // Debounce config changes
    );

    // This reaction starts/stops the realtime loop based on the isRealtimeGraph flag.
    reaction(
      () => this.isRealtimeGraph,
      (isRealtime) => {
        if (isRealtime) {
          this.startRealtimeLoop();
        } else {
          this.stopRealtimeLoop();
          // After stopping, run once to ensure a final state.
          this.runExecution();
        }
      }
    );
  }

  private updateNodeConfigsAndRealtimeStatus() {
    if (!this.executor) return;

    const state = this.appController.observableState;
    let anyRealtime = false;

    for (const node of Object.values(state.graph.inner.nodes)) {
      const { typeId } = node.config;
      const nodeType = this.nodeRepository.getNodeType(typeId);
      if (!nodeType) continue;

      const instanceConfig = nodeType.compileConfig
        ? nodeType.compileConfig(node.config)
        : node.config;

      const emptyConfig = { fields: {}, untagged: [] };
      this.executor.setNodeConfig(node.id, (instanceConfig ?? emptyConfig) as any);

      // Update virtual literal nodes if they exist
      if (node.config.values) {
        for (const [portName, value] of Object.entries(node.config.values)) {
          const virtualNodeId = `${node.id}-virtual-${portName}`;
          // We can safely call setNodeConfig; if the node doesn't exist (because it was connected), it does nothing.
          this.executor.setNodeConfig(virtualNodeId, value as any);
        }
      }

      // Check if node is realtime. We cast to any to access the new optional method.
      const isRealtime = (nodeType.definition as Partial<PrimitiveNodeDefinition>).isRealtime?.((instanceConfig ?? emptyConfig) as any) ?? false;
      this.realtimeNodeCache.set(node.id, isRealtime);
      if (isRealtime) {
        anyRealtime = true;
      }
    }

    // Update the observable that controls the loop, if it has changed.
    if (this.isRealtimeGraph !== anyRealtime) {
      runInAction(() => {
        this.isRealtimeGraph = anyRealtime;
      });
    }
  }

  private getStructuralSignature(state: AppState): string {
    const nodeIds = Object.values(state.graph.inner.nodes)
      .map(n => `${n.id}:${n.config.typeId}`)
      .sort()
      .join(',');
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
    return JSON.stringify(
      Object.values(state.graph.inner.nodes).map((n) => n.config)
    );
  }

  private recompileAndRun() {
    console.log('Recompiling graph...');
    const state = this.appController.observableState;
    const graphDef = compileGraph(
      state,
      this.localController.observableState.loadedSubgraphs,
      this.nodeRepository
    );

    const newExecutor = new GraphExecutor(graphDef, this.nodeRepository);

    runInAction(() => {
      this.executor = newExecutor;
      this.realtimeNodeCache.clear();
      this.updateNodeConfigsAndRealtimeStatus();

      // If we are not in realtime mode after recompiling, run once.
      // If we are, the loop will be started by the isRealtimeGraph reaction.
      if (!this.isRealtimeGraph) {
        this.runExecution();
      }
    });
  }

  private startRealtimeLoop() {
    if (this.animationFrameId !== null) return;
    console.log(`Starting real-time execution loop at ${FRAME_RATE} FPS.`);

    const loop = () => {
      if (!this.executor) {
        this.stopRealtimeLoop();
        return;
      }

      // Mark all real-time nodes as dirty for this frame.
      for (const [nodeId, isRealtime] of this.realtimeNodeCache.entries()) {
        if (isRealtime) {
          this.executor.markDirty(nodeId);
        }
      }

      // Assuming 120 BPM for beat calculation
      const BPM = 120;
      const beatsPerSecond = BPM / 60;
      const dt = 1 / FRAME_RATE;
      this.clock.beat += dt * beatsPerSecond;

      // Pass clock state to execution, which will now only process dirty nodes.
      this.runExecution({ clock: { beat: this.clock.beat, dt } });
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private stopRealtimeLoop() {
    if (this.animationFrameId !== null) {
      console.log('Stopping real-time execution loop.');
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private runExecution(contextUpdate?: { clock: { beat: number; dt: number } }) {
    if (!this.executor) {
      return;
    }

    const startTime = performance.now();
    // Pass clock context to executor. Assuming executor.update is modified.
    this.executor.update(contextUpdate ?? {});
    const endTime = performance.now();

    const newOutputs = this.executor.getOutputs();
    const newStats = {
      nodeCount: this.executor.graphNodeCount,
      executionTime: endTime - startTime,
    };

    runInAction(() => {
      this.outputs.clear();
      for (const [key, value] of newOutputs.entries()) {
        this.outputs.set(key, structuredClone(value));
      }
      this.stats = newStats;
    });

    if (!this.isRealtimeGraph) {
      console.log(`Execution finished in ${newStats.executionTime.toFixed(2)}ms`);
    }
  }
}
