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
import { BeatSyncManager } from './beat-sync-manager';

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
  private pendingDirtyNodeIds = new Set<string>();

  private compilerWorker: Worker;
  private executorWorker: Worker;
  private audioRenderer = new AudioRenderer();
  public beatSyncManager: BeatSyncManager;

  constructor(
    private appController: AppController,
    private localController: LocalController
  ) {
    this.beatSyncManager = new BeatSyncManager(
      localController,
      (port) => this.connectExecutorToBeatSync(port),
      (enabled) => this.sendResolumeSettings(enabled)
    );
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

    // Sync MIDI state to worker (State Persistence)
    // TODO: Fix this reaction
    reaction(
      () => {
        // Track changes in both maps
        return {
          ccVersion: midiManager.state.ccValues.size + Array.from(midiManager.state.ccValues.values()).reduce((a, b) => a + b, 0),
          cc: new Map(midiManager.state.ccValues),
          notes: new Map(midiManager.state.activeNotes),
        };
      },
      ({ cc, notes }) => {
        const values = new Map<string, number>();
        for (const [k, v] of cc) values.set(k, v);
        for (const [k, v] of notes) values.set(k, v);

        // Send STATE update
        const msg: ExecutorWorkerMessage = {
          type: 'MIDI_UPDATE',
          values,
          events: [] // Events handled by listener
        };
        this.executorWorker.postMessage(msg);
      },
      { delay: 16 } // Throttle to ~60fps
    );

    // Listen for MIDI Events (Transient)
    midiManager.onMidiEvent((event) => {
      this.midiEventBuffer.push(event);
    });

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
    this.beatSyncManager.resumeAudio();
  }

  public sendResolumeControl(action: 'connect' | 'disconnect') {
    const msg: ExecutorWorkerMessage = {
      type: 'RESOLUME_CONTROL',
      action
    };
    this.executorWorker.postMessage(msg);
  }

  public sendResolumeParameter(path: string, value: any) {
    const msg: ExecutorWorkerMessage = {
      type: 'RESOLUME_SET_VALUE',
      path,
      value
    };
    this.executorWorker.postMessage(msg);
  }

  public sendResolumeSettings(enabled: boolean) {
    const msg: ExecutorWorkerMessage = {
      type: 'RESOLUME_SETTINGS',
      enabled
    };
    this.executorWorker.postMessage(msg);
  }

  public connectExecutorToBeatSync(port: MessagePort) {
    const msg: ExecutorWorkerMessage = {
      type: 'CONNECT_AUX_PORT',
      port
    };
    this.executorWorker.postMessage(msg, [port]);
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

      // DIRECT UPDATE
      this.localController.updateInferredTypes(msg.inferredNodeTypes, (nodeId) => {
        return this.appController.observableState.graph.inner.nodes[nodeId]?.config.typeId;
      });
    }
  }

  private virtualInputMappings: Record<string, Record<string, string>> = {};
  public outputRemappings: Record<string, Record<string, string>> = {};

  private handleGraphCompiled(msg: GraphCompiledMessage) {
    this.virtualInputMappings = msg.virtualInputMappings || {};
    this.outputRemappings = msg.outputRemappings || {};

    // Clear stale state for new graph
    runInAction(() => {
      this.outputs.clear();
      this.inputs.clear();
      this.uiStates.clear();
    });

    const initMsg: ExecutorWorkerMessage = {
      type: 'INIT_GRAPH',
      graph: msg.graph,
      inferredNodeTypes: msg.inferredTypes,
      isRecompilation: this.hasLoadedGraph,
      dirtyNodeIds: Array.from(this.pendingDirtyNodeIds),
      nodeMetadata: msg.nodeMetadata,
      idMap: msg.idMap
    };
    this.pendingDirtyNodeIds.clear(); // Clear after sending
    this.hasLoadedGraph = true;
    this.executorWorker.postMessage(initMsg);

    // Populate local cache with inferred types directly
    // DIRECT UPDATE to avoid AppController.dispatch() which triggers LongEdit re-application loops
    if (msg.inferredTypes) {
      this.localController.updateInferredTypes(msg.inferredTypes, (nodeId) => {
        return this.appController.observableState.graph.inner.nodes[nodeId]?.config.typeId;
      });
    }

    // Populate local cache with compiled configs from the graph
    runInAction(() => {
      for (const [nodeId, instance] of Object.entries(msg.graph.nodes)) {
        if (instance.defaultConfig) {
          // Cache config for root nodes (matching AppState IDs) for UI use.
          // Subgraph node IDs are prefixed and handled separately by the worker.
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
      const nodeConfig = toJS(node.config);
      nodesToSend.push({ id: node.id, typeId: node.config.typeId, config: nodeConfig });

      // Dynamic Propagation for Subgraphs
      // Check if this node has virtual input mappings (meaning it's a subgraph/parent node)
      const mappings = this.virtualInputMappings[node.id];
      if (mappings) {
        const values = nodeConfig.values || {};
        for (const [portName, targetId] of Object.entries(mappings)) {
          const val = values[portName];
          if (val !== undefined) {
            // Create a virtual update for the internal io.input node.
            // simulating a slider update on the internal node.
            // internal node config compatible with io.input compileConfig: { values: { '0': val } }
            nodesToSend.push({
              id: targetId,
              typeId: 'io.input',
              config: { values: { '0': val } }
            });
          }
        }
      }
    }

    if (nodesToSend.length > 0) {
      const recompileNodes = nodesToSend.filter(n => {
        const type = this.nodeRepository.getNodeType(n.typeId);
        // TODO: This should be providing oldConfig as the second argument, although most implementors ignore it.
        // The signature of shouldRecompileOnConfigChange should be (newConfig: any, oldConfig?: any) => boolean.
        return (type?.shouldRecompileOnConfigChange as any)?.(n.config) ?? false;
      });

      if (recompileNodes.length > 0) {
        // Track nodes that caused recompile
        for (const n of recompileNodes) {
          this.pendingDirtyNodeIds.add(n.id);
        }
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
        value: JSON.parse(JSON.stringify(update.inputs))
      };
      this.executorWorker.postMessage(msg);

      // Dynamic Propagation for Subgraphs (Fast Path)
      const mappings = this.virtualInputMappings[update.nodeId];
      if (mappings) {
        for (const [portName, val] of Object.entries(update.inputs)) {
          const targetId = mappings[portName];
          if (targetId) {
            // Propagate to internal io.input node
            // targetId is the flattened ID (e.g. sub1.in_float)
            const subMsg: ExecutorWorkerMessage = {
              type: 'UPDATE_INPUT',
              name: targetId,
              value: { 'value': val } as any
            };
            this.executorWorker.postMessage(subMsg);
          }
        }
      }
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

  private midiEventBuffer: any[] = [];

  private performStep() {
    this.lastStepTime = performance.now();

    // Flush buffered MIDI events
    if (this.midiEventBuffer.length > 0) {
      const msgs = this.midiEventBuffer;
      this.midiEventBuffer = []; // Clear buffer

      const msg: ExecutorWorkerMessage = {
        type: 'MIDI_UPDATE',
        values: new Map(), // Values updated via state reaction below, no need to send here if disjoint?
        // Actually, MIDI_UPDATE in worker likely expects both or merges.
        // We should double check if we can send just events.
        // Logic below in reaction sends BOTH.
        // Let's stick to the pattern: Reaction handles STATE (CC values, Active Notes).
        // This handles EVENTS (Transient).
        // If we split them, we might have race conditions or worker might need separate handlers.
        // Let's check worker logic... assuming it handles partial updates or we just send empty map.
        events: msgs
      };
      this.executorWorker.postMessage(msg);
    }

    const stepMsg: ExecutorWorkerMessage = {
      type: 'CONTROL',
      action: 'STEP'
    };
    this.executorWorker.postMessage(stepMsg);
  }

  private recompileAndRun() {
    const state = this.appController.observableState;
    const subgraphs = this.localController.observableState.loadedSubgraphs;

    const msg: CompilerWorkerMessage = {
      type: 'COMPILE_GRAPH',
      state: toJS(state),
      subgraphs: Object.fromEntries(toJS(subgraphs))
    };
    this.compilerWorker.postMessage(msg);
  }
}

