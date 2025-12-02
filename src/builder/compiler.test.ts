import { describe, it, expect } from 'vitest';
import { compileGraph } from './compiler';
import { AppState, GraphState } from './state';
import { defaultNodeRepository } from '../structor/repository';

describe('Graph Compiler', () => {
  // Helper to create a simple graph state
  function createGraph(nodes: any[], connections: any[]): GraphState {
    const nodeRecord: any = {};
    nodes.forEach(n => nodeRecord[n.id] = n);
    const connRecord: any = {};
    connections.forEach((c, i) => {
      connRecord[`c${i}`] = {
        ...c,
        fromNodeId: c.fromNode,
        toNodeId: c.toNode
      };
    });

    return {
      inner: { nodes: nodeRecord, connections: connRecord },
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    };
  }

  it('should compile a simple flat graph', () => {
    const graph = createGraph(
      [
        { id: 'n1', x: 0, y: 0, config: { typeId: 'math.add' } },
        { id: 'n2', x: 0, y: 0, config: { typeId: 'mul' } }
      ],
      [
        { fromNode: 'n1', fromPort: 'out', toNode: 'n2', toPort: 'in' }
      ]
    );

    const appState: AppState = { graph };
    const loadedSubgraphs = new Map();

    const compiled = compileGraph(appState, loadedSubgraphs, defaultNodeRepository);

    expect(Object.keys(compiled.nodes)).toHaveLength(2);
    expect(compiled.nodes['n1'].definitionId).toBe('math.add');
    expect(compiled.nodes['n2'].definitionId).toBe('mul');
    expect(compiled.connections).toHaveLength(1);
    expect(compiled.connections[0]).toEqual({
      fromNode: 'n1', fromPort: 'out',
      toNode: 'n2', toPort: 'in'
    });
  });

  it('should flatten a subgraph and rewire connections', () => {
    // Define Subgraph
    // In -> Add -> Out
    const subgraph = createGraph(
      [
        { id: 'sub_in', x: 0, y: 0, config: { typeId: 'io.input', name: 'A' } },
        { id: 'sub_add', x: 0, y: 0, config: { typeId: 'math.add' } },
        { id: 'sub_out', x: 0, y: 0, config: { typeId: 'io.output', name: 'B' } }
      ],
      [
        { fromNode: 'sub_in', fromPort: 'val', toNode: 'sub_add', toPort: 'a' },
        { fromNode: 'sub_add', fromPort: 'sum', toNode: 'sub_out', toPort: 'val' }
      ]
    );

    const loadedSubgraphs = new Map([['my_sub', subgraph]]);

    // Define Main Graph
    // Node1 -> SubgraphNode -> Node2
    const mainGraph = createGraph(
      [
        { id: 'n1', x: 0, y: 0, config: { typeId: 'const' } },
        { id: 'sub1', x: 0, y: 0, config: { typeId: 'core.subgraph', subgraphId: 'my_sub' } },
        { id: 'n2', x: 0, y: 0, config: { typeId: 'print' } }
      ],
      [
        // Connect n1 to subgraph input 'A'
        { fromNode: 'n1', fromPort: 'val', toNode: 'sub1', toPort: 'A' },
        // Connect subgraph output 'B' to n2
        { fromNode: 'sub1', fromPort: 'B', toNode: 'n2', toPort: 'val' }
      ]
    );

    const appState: AppState = { graph: mainGraph };

    const compiled = compileGraph(appState, loadedSubgraphs, defaultNodeRepository);

    // Check Nodes
    // Should have: n1, n2, sub1.sub_in, sub1.sub_add, sub1.sub_out
    expect(Object.keys(compiled.nodes)).toHaveLength(5);
    expect(compiled.nodes['sub1.sub_add']).toBeDefined();
    expect(compiled.nodes['sub1.sub_add'].definitionId).toBe('math.add');

    // Check Connections
    // 1. Internal subgraph connections (rewired with prefix)
    // sub_in -> sub_add
    expect(compiled.connections).toContainEqual({
      fromNode: 'sub1.sub_in', fromPort: 'val',
      toNode: 'sub1.sub_add', toPort: 'a'
    });
    // sub_add -> sub_out
    expect(compiled.connections).toContainEqual({
      fromNode: 'sub1.sub_add', fromPort: 'sum',
      toNode: 'sub1.sub_out', toPort: 'val'
    });

    // 2. External connections (rewired to internal nodes)
    // n1 -> sub1.sub_in (was n1 -> sub1:A)
    expect(compiled.connections).toContainEqual({
      fromNode: 'n1', fromPort: 'val',
      toNode: 'sub1.sub_in', toPort: 'val'
    });
    // sub1.sub_out -> n2 (was sub1:B -> n2)
    expect(compiled.connections).toContainEqual({
      fromNode: 'sub1.sub_out', fromPort: 'val',
      toNode: 'n2', toPort: 'val'
    });
  });
  describe('Virtual Inputs', () => {
    it('should generate literal nodes for configured virtual inputs', () => {
      const graph = createGraph(
        [
          {
            id: 'n1', x: 0, y: 0,
            config: {
              typeId: 'math.clamp',
              values: { 'min': 0.5, 'max': 1.0 }
            }
          }
        ],
        []
      );

      const appState: AppState = { graph };
      const loadedSubgraphs = new Map();

      const compiled = compileGraph(appState, loadedSubgraphs, defaultNodeRepository);

      // Should have: n1 only (virtual inputs are injected into config)
      expect(Object.keys(compiled.nodes)).toHaveLength(1);

      // Check Config Injection
      const n1 = compiled.nodes['n1'];
      expect(n1).toBeDefined();
      expect((n1.defaultConfig as any).values).toEqual({ 'min': 0.5, 'max': 1.0, 'value': 0 });

      // Check Connections (Should be empty as no literal nodes are created)
      expect(compiled.connections).toHaveLength(0);
    });

    it('should NOT generate literal nodes if port is connected', () => {
      const graph = createGraph(
        [
          {
            id: 'n1', x: 0, y: 0,
            config: {
              typeId: 'math.clamp',
              values: { 'min': 0.5 } // Virtual input configured
            }
          },
          { id: 'n2', x: 0, y: 0, config: { typeId: 'data.literal', literal: { value: 0.1 } } }
        ],
        [
          // But 'min' is connected to n2
          { fromNode: 'n2', fromPort: '', toNode: 'n1', toPort: 'min' }
        ]
      );

      const appState: AppState = { graph };
      const loadedSubgraphs = new Map();

      const compiled = compileGraph(appState, loadedSubgraphs, defaultNodeRepository);

      // Should have: n1, n2. NO virtual node for min.
      expect(Object.keys(compiled.nodes)).toHaveLength(2);
      expect(compiled.nodes['n1-virtual-min']).toBeUndefined();

      // Check Connections
      expect(compiled.connections).toHaveLength(1);
      expect(compiled.connections[0]).toEqual({
        fromNode: 'n2', fromPort: '',
        toNode: 'n1', toPort: 'min'
      });
    });
  });
});

