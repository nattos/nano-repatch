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
  @observable inputs = new Map<string, any>();
  @observable stats = {
    nodeCount: 0,
    executionTime: 0,
  };
  @observable isRealtimeGraph = false;
  @observable frame = 0;

  private nodeRepository = defaultNodeRepository;
  private realtimeNodeCache = new Map<string, boolean>();
  private hasLoadedGraph = false;

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

    // Subscribe to graph changes
    this.appController.onCompiledGraphDirty(() => {
      this.recompileAndRun();
    });

    this.appController.onConfigChange((nodeIds) => {
      this.updateNodeConfigsAndRealtimeStatus(nodeIds);
    });

    this.appController.onInputUpdate((updates) => {
      this.handleInputUpdates(updates);
    });

    // Sync MIDI state to worker
    reaction(
      () => {
        // Track changes in both maps
        return {
          ccVersion: midiManager.state.ccValues.size + Array.from(midiManager.state.ccValues.values()).reduce((a, b) => a + b, 0),
          cc: new Map(midiManager.state.ccValues),
          notes: new Map(midiManager.state.activeNotes),
          // Also track recent events length/content to trigger updates
          eventsVersion: midiManager.state.recentEvents.length > 0 ? midiManager.state.recentEvents[0] : null
        };
      },
      ({ cc, notes }) => {
        const values = new Map<string, number>();
        for (const [k, v] of cc) values.set(k, v);
        for (const [k, v] of notes) values.set(k, v);

        // Send all recent events?
        // Ideally we only send *new* events.
        // But since we throttle to 16ms, we might miss some if we just take "recent".
        // However, `recentEvents` is a buffer.
        // Let's send the whole buffer (max 20) and let the worker filter by time?
        // Or just send them all. 20 events is small.
        // The worker will process them.
        // Wait, if we send duplicates, the worker might re-trigger.
        // We should filter by time or ID.
        // But the worker is stateless regarding "last received event" unless we persist it.
        // Actually, `executor.worker` runs every tick.
        // If we send events, they are "consumed" or "buffered"?
        // If we send `MIDI_UPDATE`, it updates the context.
        // If the context holds `events`, and the node reads them...
        // If the node reads them every frame, it will re-trigger.
        // So the worker needs to clear events after processing?
        // Or the message should only contain *new* events, and the worker appends them to a queue for the *next* frame?

        // Let's assume the worker treats `msg.events` as "events arrived since last update".
        // So we need to track what we sent.

        const events = midiManager.state.recentEvents; // These are sorted newest first?
        // `unshift` puts newest at 0.
        // So we want to send events that are newer than `lastSentEventTime`.

        const newEvents = events.filter(e => (e.time ?? 0) > this.lastMidiEventTime).reverse(); // Oldest first

        if (newEvents.length > 0) {
          this.lastMidiEventTime = newEvents[newEvents.length - 1].time ?? Date.now();
        }

        const msg: ExecutorWorkerMessage = {
          type: 'MIDI_UPDATE',
          values,
          events: newEvents
        };
        this.executorWorker.postMessage(msg);
      },
      { delay: 16 } // Throttle to ~60fps
    );
  }

  private lastMidiEventTime = 0;

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
      graph: msg.graph,
      isRecompilation: this.hasLoadedGraph
    };
    this.hasLoadedGraph = true;
    this.executorWorker.postMessage(initMsg);

    // After init, we need to send current configs
    // But we SKIP sending UPDATE_CONFIG because INIT_GRAPH already has the correct (compiled) config
    // which includes injected defaults that AppState might miss.
    this.updateNodeConfigsAndRealtimeStatus(undefined, true);

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
      this.inputs.clear();
      if (msg.inputs) {
        if (msg.inputs instanceof Map) {
          for (const [key, value] of msg.inputs.entries()) {
            this.inputs.set(key, value);
          }
        } else {
          for (const [key, value] of Object.entries(msg.inputs)) {
            this.inputs.set(key, value);
          }
        }
      }
      this.stats = msg.stats;
      this.frame++;
    });

    if (msg.audioCommands) {
      this.audioRenderer.execute(msg.audioCommands);
    }
  }

  private updateNodeConfigsAndRealtimeStatus(nodeIds?: string[], skipUpdateConfig = false) {
    const state = this.appController.observableState;
    let anyRealtime = false;

    // If nodeIds provided, only update those configs.
    // But we still need to check ALL nodes for realtime status to determine global `isRealtimeGraph`.
    // Optimization: Track realtime status per node in a map, update only changed ones, then check if any are true.

    const nodesToCheck = nodeIds
      ? nodeIds.map(id => state.graph.inner.nodes[id]).filter(n => !!n)
      : Object.values(state.graph.inner.nodes);

    for (const node of nodesToCheck) {
      const nodeConfig = toJS(node.config);
      const { typeId } = nodeConfig;
      const nodeType = this.nodeRepository.getNodeType(typeId);
      if (!nodeType) continue;

      const instanceConfig = nodeType.compileConfig
        ? nodeType.compileConfig(nodeConfig)
        : nodeConfig;

      const emptyConfig = { fields: {}, untagged: [] };
      const finalConfig = (instanceConfig ?? emptyConfig) as any;

      // Send config update to worker
      if (!skipUpdateConfig) {
        const updateMsg: ExecutorWorkerMessage = {
          type: 'UPDATE_CONFIG',
          nodeId: node.id,
          config: toJS(finalConfig),
          isRealtime: false // Placeholder, logic below
        };
        this.executorWorker.postMessage(updateMsg);
      }

      // Check if node is realtime
      const isRealtime = (nodeType.definition as Partial<PrimitiveNodeDefinition>).isRealtime?.(finalConfig) ?? false;
      this.realtimeNodeCache.set(node.id, isRealtime);
    }

    // Recalculate global realtime status
    for (const isRealtime of this.realtimeNodeCache.values()) {
      if (isRealtime) {
        anyRealtime = true;
        break;
      }
    }

    // Update the observable that controls the loop
    if (this.isRealtimeGraph !== anyRealtime) {
      runInAction(() => {
        this.isRealtimeGraph = anyRealtime;
      });

      // Send control message
      const msg: ExecutorWorkerMessage = {
        type: 'CONTROL',
        action: anyRealtime ? 'START' : 'STOP',
        frameRate: FRAME_RATE
      };
      this.executorWorker.postMessage(msg);
    }

    // If not realtime, we should trigger a single execution step to update outputs
    if (!this.isRealtimeGraph) {
      const stepMsg: ExecutorWorkerMessage = {
        type: 'CONTROL',
        action: 'STEP'
      };
      this.executorWorker.postMessage(stepMsg);
    }
  }

  private handleInputUpdates(updates: { nodeId: string, inputs: Record<string, any> }[]) {
    // Optimized update for inputs (values)
    for (const update of updates) {
      // Send UPDATE_INPUT to the worker
      // The worker will merge these values into the node's config
      const msg: ExecutorWorkerMessage = {
        type: 'UPDATE_INPUT',
        name: update.nodeId,
        value: toJS(update.inputs) as any
      };
      this.executorWorker.postMessage(msg);
    }

    // Trigger step if not realtime
    if (!this.isRealtimeGraph) {
      const stepMsg: ExecutorWorkerMessage = {
        type: 'CONTROL',
        action: 'STEP'
      };
      this.executorWorker.postMessage(stepMsg);
    }
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

