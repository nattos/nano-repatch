import { describe, it, expect } from 'vitest';
import { GraphCompiler, ExpressionExecutor } from "./parser";

describe('Expression Parser & Executor', () => {
  const compiler = new GraphCompiler();
  const executor = new ExpressionExecutor();

  it('Basic Math (1 + 2)', () => {
    const code = `1 + 2`;
    const graph = compiler.compile(code);
    const result = executor.execute(graph, {});
    expect(result).toBe(3);
  });

  it('Variable Scope & Re-use', () => {
    const code = `
      let a = 10;
      let b = 5;
      let sum = a + b;
      sum * 2
    `;
    const graph = compiler.compile(code);
    const result = executor.execute(graph, {});
    expect(result).toBe(30);
  });

  it('External Inputs (Arbitrary Shapes)', () => {
    // Here we expect 'config' and 'sensor' to be passed in at runtime
    const code = `
      let threshold = config.maxVal;
      let current = sensor.value;
      current + threshold
    `;
    const graph = compiler.compile(code);

    const context = {
      config: { maxVal: 100 },
      sensor: { value: 55 }
    };

    const result = executor.execute(graph, context);
    expect(result).toBe(155);
  });

  it('Internal Object Creation (Structs)', () => {
    const code = `
      let x = 10;
      let point = { x: x, y: 20 };
      point.x + point.y
    `;
    const graph = compiler.compile(code);
    const result = executor.execute(graph, {});
    expect(result).toBe(30);
  });

  it('Standard Math Library Access', () => {
    // Math is treated as an external input (available in global scope fallback)
    const code = `Math.PI * 2`;
    const graph = compiler.compile(code);
    const result = executor.execute(graph, {}); // No inputs provided
    expect(result).toBe(Math.PI * 2);
  });

  it('Execution Graph Serialization Check', () => {
    const code = `10 + 20`;
    const graph = compiler.compile(code);

    // Ensure it is pure JSON
    const json = JSON.stringify(graph);
    const parsed = JSON.parse(json);

    expect(parsed.rootId).not.toBeNull();
    expect(Object.keys(parsed.nodes).length).toBe(3);

    // Re-execute from parsed JSON
    const result = executor.execute(parsed, {});
    expect(result).toBe(30);
  });
});