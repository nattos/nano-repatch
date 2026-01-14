import '../customnodes/registration-worker';
import { GraphExecutor } from '../structor/executor';
import { defaultNodeRepository } from '../structor/repository';
import { ExecutorWorkerMessage, ExecutionUpdateMessage, AuxClockMessage, AuxClockStreamMessage } from './types';
import { Structor, StructorRecord } from '../structor/structor';
import { resolumeManager } from '../io/resolume/manager';
import { VirtualAudioContext } from '../audio/virtual-audio';
import { ExternalClockDebugData } from '../beatsync/schema';

// --- Resolume Logic (Worker Side) ---
class ResolumeLogic {
  private enabled = false;
  private pendingResync = false;
  private lastBarPhase = 0;
  private currentAuxPort: MessagePort | null = null;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  handlePort(port: MessagePort) {
    if (this.currentAuxPort) {
      this.currentAuxPort.close();
      this.currentAuxPort.onmessage = null;
    }
    this.currentAuxPort = port;
    this.currentAuxPort.onmessage = (e) => this.onMessage(e);
  }

  private onMessage(e: MessageEvent) {
    const msg = e.data as (AuxClockMessage | AuxClockStreamMessage | { type: 'CLOCK_HARD_SYNC' });
    if (msg.type === 'CLOCK_UPDATE') {
      this.handleClockUpdate(msg);
    } else if (msg.type === 'CLOCK_STREAM') {
      this.handleClockStream(msg);
    } else if (msg.type === 'CLOCK_HARD_SYNC') {
      this.handleHardSync();
    }
  }

  private handleHardSync() {
    if (!this.enabled) return;
    // User requested simplified logic: only send resync trigger, BPM is already synced via CLOCK_UPDATE
    resolumeManager.setValue('/composition/tempocontroller/resync', true);
    resolumeManager.setValue('/composition/tempocontroller/resync', false);
    this.pendingResync = false;
  }

  private handleClockUpdate(msg: AuxClockMessage) {
    if (!this.enabled) return;

    if (msg.bpm) {
      resolumeManager.setValue('/composition/tempocontroller/tempo', msg.bpm);
    }

    if (msg.phase !== undefined || msg.kind === 'sync' || msg.kind === 'nudge') {
      this.pendingResync = true;
    }
  }

  private handleClockStream(msg: AuxClockStreamMessage) {
    if (!this.enabled) return;

    // Check bar crossing
    const debugData: ExternalClockDebugData = msg.data;
    const barPhase = debugData.barPhase; // Assumes ExternalClockDebugData shape
    if (this.pendingResync) {
      const currentBarIndex = Math.floor(barPhase / 4);
      const lastBarIndex = Math.floor(this.lastBarPhase / 4);

      if (currentBarIndex > lastBarIndex) {
        // console.log('[Executor] Triggering Resolume Resync');
        resolumeManager.setValue('/composition/tempocontroller/resync', true);
        resolumeManager.setValue('/composition/tempocontroller/resync', false);
        this.pendingResync = false;
      }
    }
    this.lastBarPhase = barPhase;
  }
}

const resolumeLogic = new ResolumeLogic();

let executor: GraphExecutor | null = null;
let intervalId: any = null;
let frameRate = 60;
let isRunning = false;
let virtualAudioContext = new VirtualAudioContext();
let compiledToSourceMap = new Map<string, string>();

// Clock state
let clock = { beat: 0 };
let workerMidiValues = new Map<string, number>();
let workerMidiEvents: any[] = [];

self.onerror = (e) => {
  console.error('Executor Worker Error (Global):', e);
};

self.onmessage = (event: MessageEvent<ExecutorWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'CONNECT_AUX_PORT':
      resolumeLogic.handlePort(msg.port);
      break;

    case 'RESOLUME_SETTINGS':
      resolumeLogic.setEnabled(msg.enabled);
      break;

    case 'INIT_GRAPH':
      // console.log('Executor Worker: Initializing graph...');
      let initialStates;
      let userNodeStates;
      let oldInputs;

      if (msg.isRecompilation && executor) {
        initialStates = executor.getNodeStates();
        userNodeStates = executor.getUserNodeStates();
        oldInputs = executor.getInputs();
      }

      executor = new GraphExecutor(msg.graph, defaultNodeRepository, initialStates, msg.inferredNodeTypes, msg.dirtyNodeIds, msg.nodeMetadata, msg.idMap);

      if (msg.idMap) {
        compiledToSourceMap.clear();
        for (const [sourceId, compiledId] of Object.entries(msg.idMap)) {
          compiledToSourceMap.set(compiledId, sourceId);
        }
      }

      if (userNodeStates) {
        executor.setUserNodeStates(userNodeStates);
      }

      if (oldInputs) {
        for (const [key, value] of oldInputs) {
          executor.setInput(key, value);
        }
      }

      // Reset audio context ONLY on new graph load (not recompilation)
      if (!msg.isRecompilation) {
        virtualAudioContext.reset();
      }
      // Send inferred types back to main thread
      // We can just use the ones we received if we wanted to echo, but GraphExecutor stores them now.
      const inferredTypes = executor.getInferredNodeTypes();
      if (inferredTypes) {
        // We need to sanitize/serialize the Map
        // MessagePort maps are fine? Structured clone should handle Map and objects.
        self.postMessage({
          type: 'INFERRED_TYPES',
          inferredNodeTypes: inferredTypes
        });
      }

      break;

    case 'UPDATE_CONFIG':
      if (executor) {
        executor.setNodeConfig(msg.nodeId, msg.config);
      }
      break;

    case 'UPDATE_INPUT':
      if (executor) {
        // Check if it's a node (e.g. virtual literal node) that we can update config for
        if (executor.getNodeConfig(msg.name) !== undefined) {
          const currentConfig = executor.getNodeConfig(msg.name) || { fields: {}, untagged: [] };
          const currentValues = (currentConfig as any).values || {};
          const newConfig = {
            ...(currentConfig as any),
            values: { ...currentValues, ...msg.value as any }
          };
          executor.setNodeConfig(msg.name, newConfig);
        } else {
          executor.setInput(msg.name, msg.value);
        }
      }
      break;

    case 'CONTROL':
      if (msg.action === 'START') {
        if (msg.frameRate) frameRate = msg.frameRate;
        startLoop();
      } else if (msg.action === 'STOP') {
        stopLoop();
      } else if (msg.action === 'STEP') {
        runTick();
      }
      break;

    case 'UPDATE_AUDIO_STATE':
      virtualAudioContext.state = msg.state;
      break;

    case 'RESOLUME_CONTROL':
      if (msg.action === 'connect') {
        resolumeManager.connect();
      } else if (msg.action === 'disconnect') {
        resolumeManager.disconnect();
      }
      break;

    case 'RESOLUME_SET_VALUE':
      resolumeManager.setValue(msg.path, msg.value);
      break;

    case 'MIDI_UPDATE':
      // Update worker MIDI state
      // msg.values is a Map
      workerMidiValues = msg.values;
      if (msg.events) {
        workerMidiEvents = msg.events;
      }
      break;

    case 'NODE_MESSAGE':
      if (executor) {
        executor.handleNodeMessage(msg.nodeId, msg.message);
      }
      break;
  }
};

function startLoop() {
  if (isRunning) return;
  isRunning = true;
  // console.log('Executor Worker: Starting loop');

  intervalId = setInterval(() => {
    runTick();
  }, 1000 / frameRate);
}

function stopLoop() {
  if (!isRunning) return;
  isRunning = false;
  // console.log('Executor Worker: Stopping loop');
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function runTick() {
  if (!executor) return;

  const startTime = self.performance.now();

  // Update clock
  // Assuming 120 BPM for now, similar to main thread logic
  const BPM = 120;
  const beatsPerSecond = BPM / 60;
  const dt = 1 / frameRate;
  clock.beat += dt * beatsPerSecond;

  // Sync virtual audio time
  virtualAudioContext.currentTime = clock.beat; // Or use a separate time accumulator?
  // ToneSynthLayer uses ctx.currentTime which is usually seconds.
  // clock.beat is beats.
  // We should probably track seconds.
  // Let's add a seconds counter.
  // But for now, let's just use clock.beat as a proxy or add a seconds field.
  // Actually, let's just use a local seconds accumulator.
  // Or just rely on dt.

  // Let's assume clock.beat is fine for now, or use a separate time.
  // Better:
  // virtualAudioContext.currentTime += dt;

  // But wait, virtualAudioContext is global.
  // We should initialize it properly.
  // Let's just increment it here.
  virtualAudioContext.currentTime += dt;

  try {
    executor.update({
      clock: { beat: clock.beat, dt },
      audio: { context: virtualAudioContext },
      time: virtualAudioContext.currentTime,
      midi: { values: workerMidiValues, events: workerMidiEvents },
      resolume: resolumeManager
    });

    // Clear events after processing (assuming they are consumed per tick or accumulated?)
    // If we clear them here, and the next tick happens before a new message arrives, the events are gone.
    // This is correct for a stream: events are processed once.
    // However, if the frame rate is higher than MIDI update rate, we might process empty frames.
    // If frame rate is lower, we process a batch.
    // So clearing is correct.
    workerMidiEvents = [];
  } catch (e) {
    console.error('Executor Worker: Error during update', e);
    return;
  }

  const endTime = self.performance.now();

  // Prepare outputs
  const executedNodes = executor.getExecutedNodes();
  const rawOutputs = executor.getOutputs();
  const sanitizedOutputs = new Map<string, StructorRecord>();

  for (const nodeId of executedNodes) {
    const output = rawOutputs.get(nodeId);
    if (output) {
      // Remap Compiled ID -> Source ID for UI
      const sourceId = compiledToSourceMap.get(nodeId) || nodeId;
      sanitizedOutputs.set(sourceId, sanitizeStructorRecord(output));
    }
  }

  const rawInputs = executor.getInspectedInputs();
  const sanitizedInputs = new Map<string, StructorRecord>();
  // Inputs are only captured if inspected, but we should also filter by execution
  // or at least only send if changed. executedNodes is a good proxy.
  for (const nodeId of executedNodes) {
    const input = rawInputs.get(nodeId);
    if (input) {
      const sourceId = compiledToSourceMap.get(nodeId) || nodeId;
      sanitizedInputs.set(sourceId, sanitizeStructorRecord(input));
    }
  }

  const rawUiOutputs = executor.getUiOutputs();
  const filteredUiOutputs = new Map<string, any>();
  for (const nodeId of executedNodes) {
    const ui = rawUiOutputs.get(nodeId);
    if (ui !== undefined) {
      const sourceId = compiledToSourceMap.get(nodeId) || nodeId;
      filteredUiOutputs.set(sourceId, ui);
    }
  }

  const audioCommands = virtualAudioContext.flushCommands();

  const updateMsg: ExecutionUpdateMessage = {
    type: 'EXECUTION_UPDATE',
    outputs: sanitizedOutputs,
    inputs: sanitizedInputs,
    uiOutputs: filteredUiOutputs,
    stats: {
      nodeCount: executor.graphNodeCount,
      executionTime: endTime - startTime
    },
    audioCommands: audioCommands.length > 0 ? audioCommands : undefined
  };

  self.postMessage(updateMsg);
}

function sanitizeStructorRecord(record: StructorRecord): StructorRecord {
  return {
    fields: sanitizeRecord(record.fields)
  };
}

function sanitizeRecord(record: Record<string, Structor>): Record<string, Structor> {
  const result: Record<string, Structor> = {};
  for (const key in record) {
    result[key] = sanitizeStructor(record[key]);
  }
  return result;
}

function sanitizeStructor(value: Structor): Structor {
  if (typeof value === 'function') {
    return '<function>';
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeStructor);
  }
  if (typeof value === 'object' && value !== null) {
    // Check if it's a StructorRecord (has fields)
    if ('fields' in value) {
      return sanitizeStructorRecord(value as StructorRecord);
    }
    // Generic object? Should not happen in Structor types usually, but handle recursively
    return sanitizeRecord(value as unknown as Record<string, Structor>) as any;
  }
  return value;
}
