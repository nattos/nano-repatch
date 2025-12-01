import { GraphDefinition, Structor, StructorRecord } from '../structor/structor';
import { AppState, GraphState } from '../builder/state';
import { NodeType } from '../structor/repository';

// --- Compiler Worker Messages ---

export type CompileGraphMessage = {
  type: 'COMPILE_GRAPH';
  state: AppState; // Snapshot of the app state
  subgraphs: Record<string, GraphState>;
  // We can't pass functions (NodeRepository) to workers.
  // The worker will need its own instance of NodeRepository or a serialized version.
  // For now, we assume the worker imports the default repository.
};

export type GraphCompiledMessage = {
  type: 'GRAPH_COMPILED';
  graph: GraphDefinition;
};

export type CompilerWorkerMessage = CompileGraphMessage;
export type CompilerMainMessage = GraphCompiledMessage;

// --- Executor Worker Messages ---

export type InitGraphMessage = {
  type: 'INIT_GRAPH';
  graph: GraphDefinition;
  isRecompilation?: boolean;
};

export type UpdateConfigMessage = {
  type: 'UPDATE_CONFIG';
  nodeId: string;
  config: Structor;
  isRealtime: boolean; // Passed from main thread logic
};

export type UpdateInputMessage = {
  type: 'UPDATE_INPUT';
  name: string;
  value: Structor;
};

export type ControlMessage = {
  type: 'CONTROL';
  action: 'START' | 'STOP' | 'STEP';
  frameRate?: number;
};

export type MidiUpdateMessage = {
  type: 'MIDI_UPDATE';
  values: Map<string, number>;
};

export type ExecutorWorkerMessage =
  | InitGraphMessage
  | UpdateConfigMessage
  | UpdateInputMessage
  | ControlMessage
  | MidiUpdateMessage;

import { AudioCommand } from '../audio/virtual-audio';

export interface ExecutionUpdateMessage {
  type: 'EXECUTION_UPDATE';
  outputs: Map<string, StructorRecord>; // Note: Map might need serialization if not supported directly
  stats: {
    nodeCount: number;
    executionTime: number;
  };
  audioCommands?: AudioCommand[];
}

// Maps are supported in structured clone (postMessage) in modern browsers.
export type ExecutorMainMessage = ExecutionUpdateMessage;
