import '../customnodes/debug/nodes.worker';
import '../customnodes/expr/nodes';
import '../customnodes/osc/nodes';
import '../customnodes/nicepattern/nodes';
import '../customnodes/resolume/nodes';
import '../customnodes/curve/nodes';
import '../customnodes/midi/nodes';
import { GraphExecutor } from '../structor/executor';
import { defaultNodeRepository } from '../structor/repository';
import { ExecutorWorkerMessage, ExecutionUpdateMessage } from './types';
import { Structor, StructorRecord } from '../structor/structor';
import { resolumeManager } from '../io/resolume/manager';
import { VirtualAudioContext } from '../audio/virtual-audio';

let executor: GraphExecutor | null = null;
let intervalId: any = null;
let frameRate = 60;
let isRunning = false;
let virtualAudioContext = new VirtualAudioContext();

// Connect Resolume Manager (Worker instance)
// resolumeManager.connect(); // Moved to INIT_GRAPH for lazy loading

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

      executor = new GraphExecutor(msg.graph, defaultNodeRepository, initialStates);

      if (userNodeStates) {
        executor.setUserNodeStates(userNodeStates);
      }

      if (oldInputs) {
        for (const [key, value] of oldInputs) {
          executor.setInput(key, value);
        }
      }

      // Lazy connect resolume
      resolumeManager.connect();

      // Reset audio context on new graph?
      // virtualAudioContext = new VirtualAudioContext(); // Maybe?
      // For now, keep it persistent or reset if needed.
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

    case 'MIDI_UPDATE':
      // Update worker MIDI state
      // msg.values is a Map
      workerMidiValues = msg.values;
      if (msg.events) {
        workerMidiEvents = msg.events;
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
      midi: { values: workerMidiValues, events: workerMidiEvents }
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
  const rawOutputs = executor.getOutputs();
  const sanitizedOutputs = new Map<string, StructorRecord>();

  for (const [nodeId, output] of rawOutputs.entries()) {
    sanitizedOutputs.set(nodeId, sanitizeStructorRecord(output));
  }

  const rawInputs = executor.getInspectedInputs();
  const sanitizedInputs = new Map<string, StructorRecord>();
  for (const [nodeId, input] of rawInputs.entries()) {
    sanitizedInputs.set(nodeId, sanitizeStructorRecord(input));
  }

  const audioCommands = virtualAudioContext.flushCommands();

  const updateMsg: ExecutionUpdateMessage = {
    type: 'EXECUTION_UPDATE',
    outputs: sanitizedOutputs,
    inputs: sanitizedInputs,
    uiOutputs: executor.getUiOutputs(), // Will contain raw data (codes, etc.)
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
    fields: sanitizeRecord(record.fields),
    untagged: record.untagged.map(sanitizeStructor)
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
    // Check if it's a StructorRecord (has fields and untagged)
    if ('fields' in value && 'untagged' in value) {
      return sanitizeStructorRecord(value as StructorRecord);
    }
    // Generic object? Should not happen in Structor types usually, but handle recursively
    return sanitizeRecord(value as Record<string, Structor>) as any;
  }
  return value;
}
