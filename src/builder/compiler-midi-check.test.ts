
import { describe, it, expect } from 'vitest';
import { compileGraph } from './compiler';
import { AppState, GraphState } from './state';
import { NodeRepository } from '../structor/repository';
import { defineNode } from '../structor/node-helpers';
import { NodeCategory } from '../structor/structor';

describe('Compiler MIDI Check', () => {
  const repository = new NodeRepository();

  // Register a mock MIDI node
  repository.register({
    id: 'mock.midi',
    version: '1.0.0',
    displayName: 'Mock MIDI',
    metadata: { category: NodeCategory.IO },
    definition: {
      id: 'mock.midi',
      kind: 'primitive',
      execute: () => ({}),
      usesMidiDeviceIO: () => true
    } as any, // Cast to avoid full mock implementation details
    inputs: [],
    outputs: []
  });

  // Register a mock non-MIDI node
  repository.register({
    id: 'mock.normal',
    version: '1.0.0',
    displayName: 'Mock Normal',
    metadata: { category: NodeCategory.Math },
    definition: {
      id: 'mock.normal',
      kind: 'primitive',
      execute: () => ({}),
      usesMidiDeviceIO: () => false
    } as any,
    inputs: [],
    outputs: []
  });

  const createMockState = (nodeTypeId: string): AppState => ({
    graph: {
      inner: {
        nodes: {
          'n1': {
            id: 'n1',
            x: 0, y: 0,
            config: { typeId: nodeTypeId, values: {} }
          }
        },
        connections: {}
      },
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    } as any, // Simple mock
    camera: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] }
  });

  it('should detect MIDI usage for nodes declaring usesMidiDeviceIO', () => {
    const state = createMockState('mock.midi');
    const result = compileGraph(state, new Map(), repository);
    expect(result.usesMidi).toBe(true);
  });

  it('should NOT detect MIDI usage for normal nodes', () => {
    const state = createMockState('mock.normal');
    const result = compileGraph(state, new Map(), repository);
    expect(result.usesMidi).toBe(false); // Should be undefined or false
  });

  it('should NOT detect MIDI usage for empty graph', () => {
    const state: AppState = {
      graph: { inner: { nodes: {}, connections: {} } } as any,
      camera: { x: 0, y: 0, zoom: 1 },
      history: { past: [], future: [] }
    };
    const result = compileGraph(state, new Map(), repository);
    expect(result.usesMidi).toBe(false);
  });
});
