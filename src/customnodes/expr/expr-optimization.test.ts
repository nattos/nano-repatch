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
  it('compileConfig should compiled code', () => {
    const uiConfig = { code };
    const compiled: any = expressionNode.compileConfig!(uiConfig, {});

    expect(compiled.jsCode).toBeDefined();
    expect(compiled.jsCode).toContain('return');
    // V2 doesn't expose IR graph in compileConfig result anymore, just JS
    // expect(compiled.graph).toBeDefined();
  });

  // 2. Verify compilePorts
  it('compilePorts should use compiledConfig via reflection', () => {
    const uiConfig = { code };
    // Pre-compile
    const compiledConfig = expressionNode.compileConfig!(uiConfig, {});

    // V2 computeForwardPorts uses compiledConfig.inputs if available
    const ports = expressionNode.computeForwardPorts!({}, compiledConfig, {});

    // computeForwardPorts returns { inputs: { ... }, outputs: ... }
    // fields are in inputs.fields
    expect(Object.keys(ports?.inputs?.fields || {})).toHaveLength(1);
    expect(Object.keys(ports?.inputs?.fields || {})[0]).toBe('a');
  });

  it('compilePorts should fallback to parsing if compiledConfig missing/empty', () => {
    // V2 actually recompiles if needed or returns empty if dependencies missing.
    // However, if we pass empty config, it returns defaults.
    // If we want to test that it recalculates ports from source on the fly,
    // `computeForwardPorts` in `expr-eval` currently relies on `config.inputs` being populated by `compileConfig`.
    // It does NOT re-parse the code inside `computeForwardPorts`.

    // So this test case "fallback to parsing" is technically invalid for V2 architecture
    // because `computeForwardPorts` is pure and fast, relying on the heavy lifting done in `compileConfig`.

    // We should test that it handles empty inputs gracefully.

    const ports = expressionNode.computeForwardPorts!({}, { inputs: {} }, {});
    expect(Object.keys(ports?.inputs?.fields || {})).toHaveLength(0);
  });

  // 3. Verify execute
  it('execute should use compiled JS', () => {
    const uiConfig = { code: 'x + 10' };
    const compiledConfig = expressionNode.compileConfig!(uiConfig, {});

    const inputs = { x: 5 };
    const config = compiledConfig;

    // V2 Requires nodeState for runner caching
    const context: any = {
      nodeId: 'test-opt-node',
      nodeState: new Map()
    };

    const result: any = expressionNode.execute!(inputs, config, context, undefined);

    // Wrapped result in fields
    expect(result.fields.result).toBe(15);
  });

  it('execute should handle missing code gracefully', () => {
    const inputs = { x: 5 };
    const config = { jsCode: undefined };

    const context: any = {
      nodeId: 'test-opt-missing-code',
      nodeState: new Map()
    };

    const result: any = expressionNode.execute!(inputs, config, context, undefined);

    expect(result).toBeDefined();
    // V2 returns { fields: { result: 0 } } (default result)
    expect(result.fields.result).toBe(0);
  });
});
