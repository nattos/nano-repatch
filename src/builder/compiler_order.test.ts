
import { describe, it, expect } from 'vitest';
import { compileGraph, CompiledGraphResult } from './compiler';
import { GraphState } from './state';
import { NodeRepository, defaultNodeRepository } from '../structor/repository';
import '../structor/primitives'; // Register primitives

describe('Compiler Execution Order', () => {
  it('should enforce topological sort within conditional subgraphs', () => {
    // Setup Repository
    const repository = defaultNodeRepository;

    // Define Subgraph
    const subgraphId = 'scheduled_subgraph';
    const subgraphInner = {
      nodes: {
        'n1': { id: 'n1', x: 0, y: 0, config: { typeId: 'math.add', value: 10 } }, // Node 1
        'n2': { id: 'n2', x: 0, y: 0, config: { typeId: 'math.multiply', value: 2 } }, // Node 2 (depends on n1)
        'in1': { id: 'in1', x: 0, y: 0, config: { typeId: 'io.input', name: 'val' } },
        'out1': { id: 'out1', x: 0, y: 0, config: { typeId: 'io.output', name: 'result' } }
      },
      connections: {
        'c1': { id: 'c1', fromNodeId: 'in1', fromPort: 'value', toNodeId: 'n1', toPort: 'a' },
        'c2': { id: 'c2', fromNodeId: 'n1', fromPort: 'result', toNodeId: 'n2', toPort: 'a' }, // n1 -> n2
        'c3': { id: 'c3', fromNodeId: 'n2', fromPort: 'result', toNodeId: 'out1', toPort: 'value' }
      }
    };
    const subgraphState = {
      inner: subgraphInner,
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    } as unknown as GraphState;

    // Main Graph using core.thensubgraph
    // We use 'thensubgraph' because it implies conditional execution (tagged)
    // rather than 'subgraph' which is inline (flattened into main scope execution-wise? No, inline is also flattened but tags might differ?)
    // Actually 'core.subgraph' has expansionTag 'inline'.
    // 'core.thensubgraph' has expansionTag 'scheduled'.

    const mainInner = {
      nodes: {
        'trigger': { id: 'trigger', x: 0, y: 0, config: { typeId: 'core.thensubgraph', subgraphId: subgraphId, values: { val: 50 } } },
        'source': { id: 'source', x: 0, y: 0, config: { typeId: 'math.number', value: 100 } }
      },
      connections: {
        'mc1': { id: 'mc1', fromNodeId: 'source', fromPort: 'value', toNodeId: 'trigger', toPort: 'val' }
      }
    };
    const mainGraph = {
      inner: mainInner,
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    } as unknown as GraphState;

    const loadedSubgraphs = new Map<string, GraphState>();
    loadedSubgraphs.set(subgraphId, subgraphState);

    const compiled = compileGraph(
      { graph: mainGraph } as any, // AppState mock
      loadedSubgraphs,
      repository
    );

    // The flattened nodes will have IDs prefixed.
    // trigger -> subnodes.
    // For 'thensubgraph', the expansion is 'scheduled'.
    // The compiler flattens them essentially the same way but assigns executionTag.

    // We expect n1 and n2 to be present in executionOrder.
    // And we expect n1 to come BEFORE n2.

    // I need to find the actual IDs in flatNodes.
    // It's likely `trigger-n1` and `trigger-n2` (or similar prefixing).
    // Let's dump IDs to be sure.

    const n1_key = Object.keys(compiled.graph.nodes).find(k => k.endsWith('.n1'))!;
    const n2_key = Object.keys(compiled.graph.nodes).find(k => k.endsWith('.n2'))!;

    expect(n1_key).toBeDefined();
    expect(n2_key).toBeDefined();

    const order = compiled.graph.executionOrder;
    const index1 = order.indexOf(n1_key);
    const index2 = order.indexOf(n2_key);

    expect(index1).toBeGreaterThan(-1);
    expect(index2).toBeGreaterThan(-1);
    expect(index1).toBeLessThan(index2);
  });
});
