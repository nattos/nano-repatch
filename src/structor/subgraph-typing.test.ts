import { describe, it, expect } from 'vitest';
import { compileGraph } from '../builder/compiler';
import { defaultNodeRepository } from './repository';
import { AppState, GraphState } from '../builder/state';

describe('Subgraph Port Typing', () => {
  it('should infer input port types from internal io.input config', () => {
    // Defines a subgraph with typed inputs
    const subgraphState: GraphState = {
      inner: {
        nodes: {
          'in_float': { id: 'in_float', x: 0, y: 0, config: { typeId: 'io.input', name: 'f', type: 'float' } },
          'in_any': { id: 'in_any', x: 0, y: 100, config: { typeId: 'io.input', name: 'a', type: 'any' } },
        },
        connections: {},
        comments: {}
      },
      zoom: 1,
      pan: { x: 0, y: 0 }
    };

    const loadedSubgraphs = new Map<string, GraphState>();
    loadedSubgraphs.set('typed-sub', subgraphState);

    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'sub1': { id: 'sub1', x: 0, y: 0, config: { typeId: 'core.subgraph', subgraphId: 'typed-sub' } }
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


    // Check inferred types for the subgraph node
    const subNodeTypes = result.inferredTypes['sub1'];
    expect(subNodeTypes).toBeDefined();
    expect(subNodeTypes.inputs.kind).toBe('record');

    const fields = (subNodeTypes.inputs as any).fields;


    // 'f' should be number (float)
    expect(fields['f']).toBeDefined();
    expect(fields['f'].kind).toBe('atomic');
    expect(fields['f'].type).toBe('number');

    // 'a' should be any
    expect(fields['a']).toBeDefined();
    expect(fields['a'].kind).toBe('atomic');
    expect(fields['a'].type).toBe('any');
  });
});
