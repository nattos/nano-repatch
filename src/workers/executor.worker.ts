import { GraphExecutor } from '../structor/executor';
import { defaultNodeRepository } from '../structor/repository';
import { ExecutorWorkerMessage, ExecutionUpdateMessage } from './types';
import { Structor, StructorRecord } from '../structor/structor';
import '../customnodes/nicepattern/nodes';

let executor: GraphExecutor | null = null;
let intervalId: any = null;
let frameRate = 60;
let isRunning = false;

// Clock state
let clock = { beat: 0 };

self.onmessage = (event: MessageEvent<ExecutorWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'INIT_GRAPH':
      // console.log('Executor Worker: Initializing graph...');
      executor = new GraphExecutor(msg.graph, defaultNodeRepository);
      // If we were running, we keep running with the new executor
      break;

    case 'UPDATE_CONFIG':
      if (executor) {
        executor.setNodeConfig(msg.nodeId, msg.config);
      }
      break;

    case 'UPDATE_INPUT':
      if (executor) {
        executor.setInput(msg.name, msg.value);
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

  try {
    executor.update({ clock: { beat: clock.beat, dt } });
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

  const updateMsg: ExecutionUpdateMessage = {
    type: 'EXECUTION_UPDATE',
    outputs: sanitizedOutputs,
    stats: {
      nodeCount: executor.graphNodeCount,
      executionTime: endTime - startTime
    }
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
