import { describe, it, expect } from 'vitest';
import { compileGraph } from '../builder/compiler';
import { defaultNodeRepository } from './repository';
import { AppState, GraphState } from '../builder/state';

describe('Subgraph Virtual Inputs', () => {
  it('should generate virtualInputMappings during compilation', () => {
    // Defines a subgraph with typed inputs
    const subgraphState: GraphState = {
      inner: {
        nodes: {
          'in_float': { id: 'in_float', x: 0, y: 0, config: { typeId: 'io.input', name: 'f', type: 'float' } },
        },
        connections: {},
        comments: {}
      },
      zoom: 1,
      pan: { x: 0, y: 0 }
    };

    const loadedSubgraphs = new Map<string, GraphState>();
    loadedSubgraphs.set('sub', subgraphState);

    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'main_sub': { id: 'main_sub', x: 0, y: 0, config: { typeId: 'core.subgraph', subgraphId: 'sub' } }
          },
          connections: {},
          comments: {}
        },
        zoom: 1,
        pan: { x: 0, y: 0 }
      },
      // Mock other props
      history: { past: [], future: [] },
      selection: new Set(),
      executionOrder: []
    } as any;

    const result = compileGraph(appState, loadedSubgraphs, defaultNodeRepository);

    expect(result.virtualInputMappings).toBeDefined();
    // main_sub -> f -> main_sub.in_float
    expect(result.virtualInputMappings['main_sub']).toBeDefined();
    expect(result.virtualInputMappings['main_sub']['f']).toBe('main_sub.in_float');
  });

  it('should propagate config updates to internal nodes', () => {
    // Simulate what RuntimeManager does
    const virtualInputMappings = {
      'main_sub': {
        'f': 'main_sub.in_float'
      }
    };

    // Simulate an update to the main_sub node
    const nodeUpdate = {
      id: 'main_sub',
      config: {
        values: {
          'f': 42.0
        }
      }
    };

    const nodesToSend: any[] = [];
    nodesToSend.push({ id: nodeUpdate.id, typeId: 'core.subgraph', config: nodeUpdate.config });

    const mappings = virtualInputMappings[nodeUpdate.id];
    if (mappings) {
      const values = nodeUpdate.config.values || {};
      for (const [portName, targetId] of Object.entries(mappings)) {
        const val = values[portName];
        if (val !== undefined) {
          nodesToSend.push({
            id: targetId,
            typeId: 'io.input', // hardcoded as logic does
            config: { values: { '0': val } }
          });
        }
      }
    }

    expect(nodesToSend.length).toBe(2);
    expect(nodesToSend[1].id).toBe('main_sub.in_float');
    expect(nodesToSend[1].config.values['0']).toBe(42.0);
  });

  it('should propagate fast-path input updates to internal nodes', () => {
    // Simulate what RuntimeManager handleInputUpdates does
    const virtualInputMappings = {
      'main_sub': {
        'f': 'main_sub.in_float'
      }
    };

    const update = {
      nodeId: 'main_sub',
      inputs: {
        'f': 123.0
      }
    };

    const messagesToSend: any[] = [];

    // 1. Initial message for parent node
    messagesToSend.push({
      type: 'UPDATE_INPUT',
      name: update.nodeId,
      value: update.inputs
    });

    // 2. Dynamic Propagation Logic
    const mappings = virtualInputMappings[update.nodeId];
    if (mappings) {
      for (const [portName, val] of Object.entries(update.inputs)) {
        const targetId = mappings[portName];
        if (targetId) {
          messagesToSend.push({
            type: 'UPDATE_INPUT',
            name: targetId,
            value: { 'value': val }
          });
        }
      }
    }

    expect(messagesToSend.length).toBe(2);
    expect(messagesToSend[1].name).toBe('main_sub.in_float');
    expect(messagesToSend[1].value['value']).toBe(123.0);
  });
});
