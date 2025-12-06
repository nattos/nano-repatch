import { describe, it, expect, vi } from 'vitest';
import { expressionNode } from './nodes';
import { ExecutionGraph } from './parser';
import { AnyType } from '../../structor/type-helpers';

describe('Expression Node Optimization', () => {
  const code = 'a * 2';

  // 1. Verify compileConfig
  it('compileConfig should compiled code and embed graph', () => {
    const uiConfig = { code };
    const compiled = expressionNode.compileConfig!(uiConfig);

    expect(compiled.fields.code).toBe(code);
    expect(compiled.fields.graph).toBeDefined();

    const graph = (compiled.fields.graph as any) as ExecutionGraph;
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
    const ports = expressionNode.compilePorts!(node, context);

    expect(ports?.inputs).toHaveLength(1);
    expect(ports?.inputs[0].name).toBe('a');
  });

  it('compilePorts should fallback to parsing if compiledConfig missing', () => {
    const context = {
        loadedSubgraphs: new Map(),
        compiledConfig: undefined
    };
    const node = { config: { code: 'b + 1' } };

    const ports = expressionNode.compilePorts!(node, context);
    expect(ports?.inputs).toHaveLength(1);
    expect(ports?.inputs[0].name).toBe('b');
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
        expect(result.result).toBe(15);
    }
  });

  it('execute should handle missing graph gracefully', () => {
    const inputs = { x: 5 };
    const config = { fields: { code: 'x' } }; // No graph field in fields

    const result = expressionNode.execute!(inputs, config, {} as any);

    expect(result).toBeDefined();
    // execute returns StructorRecord { fields: { ... }, untagged: [] }
    // We expect { result: 0 } to be wrapped in fields.
    if (result && 'fields' in result) {
        expect(result.fields.result).toBe(0);
    } else {
        // Did we get a plain object?
        // If defineNode wasn't used properly or something? But it is used.
        // Or if it returns something else.
        throw new Error(`Expected StructorRecord, got ${JSON.stringify(result)}`);
    }
  });
});
