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
  ConfigsCompiledMessage,
  ExecutionUpdateMessage,
  InferredTypesMessage
} from '../workers/types';
import { AudioRenderer } from '../audio/audio-renderer';
import { midiManager } from '../io/midi/manager';

const FRAME_RATE = 60;


export class RuntimeManager {
  // We no longer expose the executor directly.
  // @observable executor: GraphExecutor | null = null;

  @observable outputs = new Map<string, any>();
  @observable inputs = new Map<string, any>();
  @observable uiStates = new Map<string, any>();
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

    this.appController.onGraphReset(() => {
      this.hasLoadedGraph = false;
    });

    this.appController.onConfigChange((nodeIds) => {
      this.updateNodeConfigsAndRealtimeStatus(nodeIds);
    });

    this.appController.onInputUpdate((updates) => {
      this.handleInputUpdates(updates);
    });

    // Listened in controllers.ts now
    // this.appController.onInferredTypesUpdate((inferredTypes) => {
    //     runInAction(() => {
    //         for (const [nodeId, types] of Object.entries(inferredTypes)) {
    //             this.localController.observableState.inferredNodeTypes.set(nodeId, types);
    //         }
    //     });
    // });

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

    // Resume audio context on selection change (user interaction intent)
    // We observe the selection size.
    reaction(
      () => this.localController.observableState.selection.size,
      (size) => {
        if (size > 0 && this.audioRenderer.state === 'suspended') {
          this.audioRenderer.resume();
        }
      }
    );

    // Sync audio context state to worker
    this.audioRenderer.onStateChange = (state) => {
      this.executorWorker.postMessage({
        type: 'UPDATE_AUDIO_STATE',
        state
      } as ExecutorWorkerMessage);
    };

    // Initial sync
    setTimeout(() => {
      this.executorWorker.postMessage({
        type: 'UPDATE_AUDIO_STATE',
        state: this.audioRenderer.state
      } as ExecutorWorkerMessage);
    }, 100);
  }

  public resumeAudio() {
    if (this.audioRenderer.state === 'suspended') {
      this.audioRenderer.resume();
    }
  }

  public sendNodeMessage(nodeId: string, message: any) {
    const msg: ExecutorWorkerMessage = {
      type: 'NODE_MESSAGE',
      nodeId,
      message
    };
    this.executorWorker.postMessage(msg);
  }

  private lastMidiEventTime = 0;

  private setupWorkerListeners() {
    this.compilerWorker.onmessage = (event: MessageEvent<CompilerMainMessage>) => {
      const msg = event.data;
      if (msg.type === 'GRAPH_COMPILED') {
        this.handleGraphCompiled(msg);
      } else if (msg.type === 'CONFIGS_COMPILED') {
        this.handleConfigsCompiled(msg);
      }
    };

    this.executorWorker.onmessage = (event: MessageEvent<ExecutorMainMessage>) => {
      const msg = event.data;
      if (msg.type === 'EXECUTION_UPDATE') {
        this.handleExecutionUpdate(msg);
      } else if (msg.type === 'INFERRED_TYPES') {
        this.handleInferredTypes(msg);
      }
    };
  }

  private lastInferredTypesJson = '';
  private handleInferredTypes(msg: InferredTypesMessage) {
    if (msg.inferredNodeTypes) {
      const json = JSON.stringify(msg.inferredNodeTypes);
      if (json === this.lastInferredTypesJson) return;
      this.lastInferredTypesJson = json;

      this.appController.dispatch([{
        type: 'graph.updateInferredTypes',
        inferredTypes: msg.inferredNodeTypes
      }]);
    }
  }

  private handleGraphCompiled(msg: GraphCompiledMessage) {
    // console.log('RuntimeManager: Graph compiled, initializing executor worker');
    const initMsg: ExecutorWorkerMessage = {
      type: 'INIT_GRAPH',
      graph: msg.graph,
      inferredNodeTypes: msg.inferredTypes,
      isRecompilation: this.hasLoadedGraph
    };
    this.hasLoadedGraph = true;
    this.executorWorker.postMessage(initMsg);

    // Populate local cache with inferred types
    // Populate local cache with inferred types via AppController dispatch
    if (msg.inferredTypes) {
      this.appController.dispatch([{
        type: 'graph.updateInferredTypes',
        inferredTypes: msg.inferredTypes
      }]);
    }

    // Populate local cache with compiled configs from the graph
    runInAction(() => {
      for (const [nodeId, instance] of Object.entries(msg.graph.nodes)) {
        if (instance.defaultConfig) {
          // Extract original user-facing ID if possible?
          // The graph compilation prefixes IDs (e.g. root node IDs might be same, but subgraphs have prefixes).
          // We only care about root nodes for the LocalState cache usually (for the UI).
          // If the node ID exists in our AppState, we cache it.
          // Note: compileGraph logic: nodeId = idPrefix + node.id. Root prefix is empty string?
          // processGraph(appState.graph, '', true); -> IDs are just 'n1', 'n2'.
          // So they match AppState IDs.
          this.localController.observableState.compiledNodeConfigs.set(nodeId, instance.defaultConfig);
        }
      }
    });

    // Check realtime status using the freshly loaded configs
    // We pass nodeIds=undefined to check ALL nodes.
    // We pass loadedConfigs=true to indicate we already have them in cache/graph and don't need to re-compile.
    this.checkRealtimeStatus();

    this.updateLoopState();
  }

  private handleConfigsCompiled(msg: ConfigsCompiledMessage) {
    runInAction(() => {
      for (const [nodeId, config] of Object.entries(msg.configs)) {
        this.localController.observableState.compiledNodeConfigs.set(nodeId, config);

        // Forward to executor
        const updateMsg: ExecutorWorkerMessage = {
          type: 'UPDATE_CONFIG',
          nodeId,
          config,
          isRealtime: false // We'll update loop state after
        };
        this.executorWorker.postMessage(updateMsg);
      }
    });

    this.checkRealtimeStatus();
    this.updateLoopState();
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
      this.uiStates.clear();
      if (msg.uiOutputs) {
        if (msg.uiOutputs instanceof Map) {
          for (const [key, value] of msg.uiOutputs.entries()) {
            this.uiStates.set(key, value);
          }
        } else {
          for (const [key, value] of Object.entries(msg.uiOutputs)) {
            this.uiStates.set(key, value);
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

  private updateNodeConfigsAndRealtimeStatus(nodeIds?: string[]) {
    // Collect nodes that need compilation
    const state = this.appController.observableState;
    const nodesToSend: { id: string; typeId: string; config: any }[] = [];

    const nodesToCheck = nodeIds
      ? nodeIds.map(id => state.graph.inner.nodes[id]).filter(n => !!n)
      : Object.values(state.graph.inner.nodes);

    for (const node of nodesToCheck) {
      nodesToSend.push({ id: node.id, typeId: node.config.typeId, config: toJS(node.config) });
    }

    if (nodesToSend.length > 0) {
      const needsFullRecompile = nodesToSend.some(n => {
        const type = this.nodeRepository.getNodeType(n.typeId);
        return type?.shouldRecompileOnConfigChange?.(n.config) ?? false;
      });

      if (needsFullRecompile) {
        this.recompileAndRun();
      } else {
        this.compilerWorker.postMessage({
          type: 'COMPILE_CONFIGS',
          nodes: nodesToSend
        });
      }
    }
  }

  private checkRealtimeStatus() {
    const state = this.appController.observableState;
    const compiledConfigs = this.localController.observableState.compiledNodeConfigs;

    for (const node of Object.values(state.graph.inner.nodes)) {
      const nodeConfig = compiledConfigs.get(node.id) ?? toJS(node.config);
      const { typeId } = node.config;
      const nodeType = this.nodeRepository.getNodeType(typeId);
      if (!nodeType) continue;

      const isRealtime = (nodeType.definition as Partial<PrimitiveNodeDefinition>).isRealtime?.(nodeConfig) ?? false;
      this.realtimeNodeCache.set(node.id, isRealtime);
    }
  }

  private updateLoopState() {
    // Recalculate global realtime status
    let anyRealtime = false;
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
      this.scheduleStep();
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
      this.scheduleStep();
    }
  }

  private stepScheduled = false;
  private lastStepTime = 0;

  private scheduleStep() {
    if (this.stepScheduled) return;

    const now = performance.now();
    const timeSinceLast = now - this.lastStepTime;
    const interval = 1000 / FRAME_RATE;

    if (timeSinceLast >= interval) {
      this.performStep();
    } else {
      this.stepScheduled = true;
      setTimeout(() => {
        this.performStep();
        this.stepScheduled = false;
      }, interval - timeSinceLast);
    }
  }

  private performStep() {
    this.lastStepTime = performance.now();
    const stepMsg: ExecutorWorkerMessage = {
      type: 'CONTROL',
      action: 'STEP'
    };
    this.executorWorker.postMessage(stepMsg);
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

