
import { describe, it, expect, beforeAll } from 'vitest';
import { expressionNode } from './expr-eval';

describe('Expression Node Integration', () => {
  // Helper to simulate context
  const context: any = {
    nodeState: new Map(),
    nodeId: 'test-expr-node'
  };

  beforeAll(async () => {
    // Ensure dependencies are loaded
    if (expressionNode.loadCompileDeps) {
      await expressionNode.loadCompileDeps();
    }
  });

  it('should reflect inputs from code', () => {
    const uiConfig = { code: 'return x + y * 2;' };
    // Compile first to get port definitions
    const compiled = expressionNode.compileConfig!(uiConfig, context);

    // Compute ports using compiled config
    const ports = expressionNode.computeForwardPorts!({}, compiled, context);

    expect(ports.inputs).toBeDefined();
    // Check for fields 'x' and 'y'
    const fields = (ports.inputs as any).fields;
    expect(fields['x']).toBeDefined();
    expect(fields['y']).toBeDefined();
    // Expect number type by default
    expect(fields['x'].type).toBe('number');
  });

  it('should compile valid JS code', () => {
    const config = { code: 'return a * b;' };
    const compiled = expressionNode.compileConfig!(config, context);

    expect(compiled.jsCode).toBeDefined();
    expect(compiled.jsCode).toContain('return');
    expect(compiled.diagnostics.length).toBe(0);
  });

  it('should handle compilation errors', () => {
    // Invalid syntax
    const config = { code: 'return 5 * (' };
    const compiled = expressionNode.compileConfig!(config, context);

    expect(compiled.jsCode).toBeUndefined();
    expect(compiled.diagnostics.length).toBeGreaterThan(0);
  });

  it('should execute compiled code', () => {
    const config = { code: 'return val + 10;' };
    const compiled = expressionNode.compileConfig!(config, context);

    // Initial State
    const state = expressionNode.createState!(config, context);

    // Execute 1
    // inputs: { val: 5 }
    // Note: definedNode wrapper returns StructorRecord { fields: { result: ... } }
    const result1: any = expressionNode.execute!({ val: 5 }, compiled, context, state);
    expect(result1.fields.result).toBe(15);

    // Verify state caching via Context (wrapper manages state)
    // The local 'state' variable passed to execute is ignored by wrapper.
    // We must retrieve the state that was actually used.
    // The key logic in node-helpers uses nodeId.
    const usedState = context.nodeState.get(context.nodeId) || state;

    expect((usedState as any).runner).toBeDefined();
    expect((usedState as any).lastCode).toBe(compiled.jsCode);

    // Execute 2 (should use cache)
    const result2: any = expressionNode.execute!({ val: 20 }, compiled, context, state);
    expect(result2.fields.result).toBe(30);
  });

  it('should handle execution errors gracefully', () => {
    // Code that throws
    const config = { code: 'throw new Error("oops");' };
    const compiled = expressionNode.compileConfig!(config, context);
    // Note: State key collision if we reuse nodeId.
    // Ideally we should clear nodeState or use different ID.
    // Wrapper creates new state if needed.

    const result: any = expressionNode.execute!({}, compiled, context, undefined);
    // If error caught, result is null.
    // Received can be undefined if field is missing, or null if explicit.
    // We accept either as "no result".
    const res = result.fields.result;
    expect(res == null).toBe(true);
  });

  it('should update runner when code changes', () => {
    const config1 = { code: 'return x;' };
    const compiled1 = expressionNode.compileConfig!(config1, context);
    // Manually maintain state or let wrapper do it.

    expressionNode.execute!({ x: 1 }, compiled1, context, undefined);
    const usedState = context.nodeState.get(context.nodeId);
    const runner1 = (usedState as any).runner;

    // Change code
    const config2 = { code: 'return x * 2;' };
    const compiled2 = expressionNode.compileConfig!(config2, context);

    // Execute with new compiled config
    const res: any = expressionNode.execute!({ x: 10 }, compiled2, context, undefined);

    expect(res.fields.result).toBe(20);
    expect((usedState as any).lastCode).toBe(compiled2.jsCode);
  });

  it('should support implicit returns (containerMode)', () => {
    // implicit return of x + 10
    const config = { code: 'x + 10' };
    const compiled = expressionNode.compileConfig!(config, context);

    expect(compiled.jsCode).toBeDefined();
    expect(compiled.jsCode).toContain('return');

    // Execute
    const result: any = expressionNode.execute!({ x: 5 }, compiled, context, undefined);
    expect(result.fields.result).toBe(15);
  });
});
