import { describe, it, expect, beforeAll } from 'vitest';
import { expressionNode } from './expr-eval';
import { ExecutionGraph } from './expr-types';

describe('Expression Node Optimization', () => {
  const code = 'a * 2';

  beforeAll(async () => {
    // Ensure compiler is loaded
    if (expressionNode.loadCompileDeps) {
      await expressionNode.loadCompileDeps();
    }
  });

  // 1. Verify compileConfig
  it('compileConfig should compiled code and embed graph', () => {
    const uiConfig = { code };
    const compiled = expressionNode.compileConfig!(uiConfig);

    expect(compiled.code).toBe(code);
    expect(compiled.graph).toBeDefined();

    const graph = (compiled.graph as any) as ExecutionGraph;
    expect(graph.rootId).toBeDefined();

    // Check if graph has inputs
    const nodes = Object.values(graph.nodes);
    const inputNode = nodes.find(n => n.op === 'input' && n.params.key === 'a');
    expect(inputNode).toBeDefined();
  });

  // 2. Verify compilePorts
  it('compilePorts should use cached compiledConfig', () => {
    const uiConfig = { code };
    // Pre-compile
    const compiledConfig = expressionNode.compileConfig!(uiConfig);

    // Mock compiledConfig present in context
    const context = {
      loadedSubgraphs: new Map(),
      compiledConfig: compiledConfig
    };

    const node = { config: { code } };

    // Reset cache or ensure compilePorts logic prioritizes context
    const ports = expressionNode.computeForwardPorts!({}, node.config, context);

    // computeForwardPorts returns { inputs: { ... }, outputs: ... }
    // fields are in inputs.fields
    expect(Object.keys(ports?.inputs?.fields || {})).toHaveLength(1);
    expect(Object.keys(ports?.inputs?.fields || {})[0]).toBe('a');
  });

  it('compilePorts should fallback to parsing if compiledConfig missing', () => {
    const context = {
      loadedSubgraphs: new Map(),
      compiledConfig: undefined
    };
    const node = { config: { code: 'b + 1' } };

    const ports = expressionNode.computeForwardPorts!({}, node.config, context);
    expect(Object.keys(ports?.inputs?.fields || {})).toHaveLength(1);
    expect(Object.keys(ports?.inputs?.fields || {})[0]).toBe('b');
  });

  // 3. Verify execute
  it('execute should use embedded graph from config', () => {
    const uiConfig = { code: 'x + 10' };
    const compiledConfig = expressionNode.compileConfig!(uiConfig);

    // Flatten for execution (mimicking executor behavior)
    // The executor would see `inputs` and `config`

    const inputs = { x: 5 };
    const config = compiledConfig;

    const result = expressionNode.execute!(inputs, config, {} as any);

    // Wrapped result
    if ('fields' in result) {
      expect(result.fields.result).toBe(15);
    } else {
      // Fallback or error
      // expect(result.result).toBe(15);
      if (result && typeof result === 'object' && 'result' in result) {
        expect(result.result).toBe(15);
      } else {
        throw new Error("Invalid result format");
      }
    }
  });

  it('execute should handle missing graph gracefully', () => {
    const inputs = { x: 5 };
    const config = { fields: { code: 'x' } }; // No graph field in fields

    const result = expressionNode.execute!(inputs, config, {} as any);

    expect(result).toBeDefined();
    // execute returns StructorRecord { fields: { ... },  }
    // We expect { result: 0 } to be wrapped in fields.
    if (result && 'fields' in result) {
      expect(result.fields.result).toBe(0); // Fallback is 0
    } else if (result && 'result' in result) {
      expect(result.result).toBe(0);
    } else {
      // expect fallback to match strict logic
      // Current impl returns { result: 0 } or { result: null }?
      // Let's check impl: return { result: 0 };
    }
  });
});
