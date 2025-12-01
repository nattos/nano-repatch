import {
  makeObservable,
  observable,
  reaction,
  runInAction,
  toJS,
} from 'mobx';
import { AppController, AppState } from '../builder/state';
import { LocalController } from '../builder/local-state';
import { defaultNodeRepository } from '../structor/repository';
import { PrimitiveNodeDefinition } from '../structor/structor';
import {
  CompilerWorkerMessage,
  CompilerMainMessage,
  ExecutorWorkerMessage,
  ExecutorMainMessage,
  GraphCompiledMessage,
  ExecutionUpdateMessage
} from '../workers/types';
import { AudioRenderer } from '../audio/audio-renderer';
import { midiManager } from '../io/midi/manager';

const FRAME_RATE = 60;


export class RuntimeManager {
  // We no longer expose the executor directly.
  // @observable executor: GraphExecutor | null = null;

  @observable outputs = new Map<string, any>();
  @observable stats = {
    nodeCount: 0,
    executionTime: 0,
  };
  @observable isRealtimeGraph = false;

  private nodeRepository = defaultNodeRepository;
  private realtimeNodeCache = new Map<string, boolean>();

  private compilerWorker: Worker;
  private executorWorker: Worker;
  private audioRenderer = new AudioRenderer();

  constructor(
    private appController: AppController,
    private localController: LocalController
  ) {
    makeObservable(this);

    // Initialize Workers
    this.compilerWorker = new Worker(new URL('../workers/compiler.worker.ts', import.meta.url), { type: 'module' });
    this.executorWorker = new Worker(new URL('../workers/executor.worker.ts', import.meta.url), { type: 'module' });

    this.setupWorkerListeners();

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
      },
      { delay: 50 } // Debounce config changes
    );

    // This reaction starts/stops the realtime loop based on the isRealtimeGraph flag.
    reaction(
      () => this.isRealtimeGraph,
      (isRealtime) => {
        const msg: ExecutorWorkerMessage = {
          type: 'CONTROL',
          action: isRealtime ? 'START' : 'STOP',
          frameRate: FRAME_RATE
        };
        this.executorWorker.postMessage(msg);

      }
    );

    // Sync MIDI state to worker
    reaction(
      () => {
        // Track changes in both maps
        return {
          ccVersion: midiManager.state.ccValues.size + Array.from(midiManager.state.ccValues.values()).reduce((a, b) => a + b, 0), // Hack to track value changes?
          // Better: just return shallow copy or keys/values?
          // MobX maps are observable. Accessing them tracks.
          // We want to trigger when any value changes.
          // Iterating keys/values tracks.
          cc: new Map(midiManager.state.ccValues),
          notes: new Map(midiManager.state.activeNotes)
        };
      },
      ({ cc, notes }) => {
        const values = new Map<string, number>();
        for (const [k, v] of cc) values.set(k, v);
        for (const [k, v] of notes) values.set(k, v);

        const msg: ExecutorWorkerMessage = {
          type: 'MIDI_UPDATE',
          values
        };
        this.executorWorker.postMessage(msg);
      },
      { delay: 16 } // Throttle to ~60fps
    );
  }

  private setupWorkerListeners() {
    this.compilerWorker.onmessage = (event: MessageEvent<CompilerMainMessage>) => {
      const msg = event.data;
      if (msg.type === 'GRAPH_COMPILED') {
        this.handleGraphCompiled(msg);
      }
    };

    this.executorWorker.onmessage = (event: MessageEvent<ExecutorMainMessage>) => {
      const msg = event.data;
      if (msg.type === 'EXECUTION_UPDATE') {
        this.handleExecutionUpdate(msg);
      }
    };
  }

  private handleGraphCompiled(msg: GraphCompiledMessage) {
    // console.log('RuntimeManager: Graph compiled, initializing executor worker');
    const initMsg: ExecutorWorkerMessage = {
      type: 'INIT_GRAPH',
      graph: msg.graph
    };
    this.executorWorker.postMessage(initMsg);

    // After init, we need to send current configs
    this.updateNodeConfigsAndRealtimeStatus();

    // If not realtime, we might want to trigger a single frame?
    // The executor worker doesn't have a "step" command yet, but we can START/STOP or just rely on updates triggering it?
    // Actually, our executor worker only runs on loop or explicit update?
    // In the worker implementation, it only runs in `runTick` called by `setInterval`.
    // We might want a "STEP" action for non-realtime updates.
    // For now, let's assume we only run if realtime OR if we want to force an update.
    // But wait, if it's NOT realtime, we still want to see the output when we change a slider.
    // So we should probably have a way to request a single frame.
    // Let's add 'STEP' to ControlMessage later if needed.
    // For now, if not realtime, we can just START and STOP immediately? No that's hacky.
    // Let's modify the worker to run a tick on config update?
    // Or add a STEP action.
    // Let's add STEP to the worker logic in a follow-up if needed.
    // For now, let's just ensure we send configs.
  }

  private handleExecutionUpdate(msg: ExecutionUpdateMessage) {
    runInAction(() => {
      this.outputs.clear();
      // msg.outputs is a Map if transferred, or object if JSON?
      // postMessage with structured clone preserves Map.
      if (msg.outputs instanceof Map) {
        for (const [key, value] of msg.outputs.entries()) {
          this.outputs.set(key, value);
        }
      } else {
        // Fallback if it comes as object
        for (const [key, value] of Object.entries(msg.outputs)) {
          this.outputs.set(key, value);
        }
      }
      this.stats = msg.stats;
    });

    if (msg.audioCommands) {
      this.audioRenderer.execute(msg.audioCommands);
    }
  }

  private updateNodeConfigsAndRealtimeStatus() {
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
      const finalConfig = (instanceConfig ?? emptyConfig) as any;

      // Send config update to worker
      const updateMsg: ExecutorWorkerMessage = {
        type: 'UPDATE_CONFIG',
        nodeId: node.id,
        config: toJS(finalConfig),
        isRealtime: false // Placeholder, logic below
      };
      this.executorWorker.postMessage(updateMsg);

      // Update virtual literal nodes if they exist
      if (node.config.values) {
        for (const [portName, value] of Object.entries(node.config.values)) {
          const virtualNodeId = `${node.id}-virtual-${portName}`;
          const virtualMsg: ExecutorWorkerMessage = {
            type: 'UPDATE_CONFIG',
            nodeId: virtualNodeId,
            config: toJS(value) as any,
            isRealtime: false
          };
          this.executorWorker.postMessage(virtualMsg);
        }
      }

      // Check if node is realtime
      const isRealtime = (nodeType.definition as Partial<PrimitiveNodeDefinition>).isRealtime?.(finalConfig) ?? false;
      this.realtimeNodeCache.set(node.id, isRealtime);
      if (isRealtime) {
        anyRealtime = true;
      }
    }

    // Update the observable that controls the loop
    if (this.isRealtimeGraph !== anyRealtime) {
      runInAction(() => {
        this.isRealtimeGraph = anyRealtime;
      });
    }

    // If not realtime, we should trigger a single execution step to update outputs
    if (!this.isRealtimeGraph) {
      // We need a way to trigger one frame.
      // Let's send a special control message or just rely on the worker running one tick?
      // The worker currently only runs on loop.
      // I'll add a 'STEP' action to the worker in a moment.
      const stepMsg: ExecutorWorkerMessage = {
        type: 'CONTROL',
        action: 'STEP' as any // We need to update types.ts
      };
      this.executorWorker.postMessage(stepMsg);
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
    // console.log('RuntimeManager: Sending compile request...');
    const state = this.appController.observableState;
    // We need to snapshot the state to avoid passing observables directly if that's an issue?
    // postMessage uses structured clone. Observables might have extra properties.
    // But usually MobX proxies are transparent enough or we should use `toJS`.
    // Let's use a simplified snapshot or rely on structured clone.
    // `state` is a complex object. `toJS` from MobX is safer.
    // But `state` is `AppState`.
    // Let's try passing it directly first. If it fails, we use `toJS`.
    // Actually, `state` contains `GraphState` which contains `GridNode`s.
    // It should be fine.

    // Wait, `subgraphs` from localController.
    const subgraphs = this.localController.observableState.loadedSubgraphs;

    const msg: CompilerWorkerMessage = {
      type: 'COMPILE_GRAPH',
      state: toJS(state),
      subgraphs: Object.fromEntries(toJS(subgraphs))
    };
    this.compilerWorker.postMessage(msg);
  }
}

