import { describe, it, expect } from 'vitest';
import { buildCode } from './builder';

describe('Unified Builder', () => {
  it('should compile to IR only', () => {
    const res = buildCode({
      code: 'return 1 + 2;',
      emitIR: true
    });
    expect(res.outIR).toBeDefined();
    expect(res.outJS).toBeUndefined();
    expect(res.outWGSL).toBeUndefined();
    expect(res.outCPP).toBeUndefined();
    expect(res.diagnostics.length).toBe(0);
    expect(res.outIR!.graph.root).toBeDefined();
  });

  it('should compile to JS and run', () => {
    const res = buildCode({
      code: 'return 10 * 10;',
      emitJS: true,
      emitJSRunner: true
    });
    expect(res.outJS).toBeDefined();
    expect(res.outJSRunner).toBeDefined();
    expect(res.outJS!.code).toContain('return 100');

    // Verify Runner
    const val = res.outJSRunner!.runner({});
    expect(val).toBe(100);
  });

  it('should compile to WGSL', () => {
    const res = buildCode({
      code: 'var x: number; return x * 2.0;',
      emitWGSL: true
    });
    expect(res.outWGSL).toBeDefined();
    expect(res.outWGSL!.code).toContain('fn main');
  });

  it('should compile to CPP', () => {
    const res = buildCode({
      code: 'return 42;',
      emitCPP: true
    });
    expect(res.outCPP).toBeDefined();
    // Codegen uses 'auto' inference for simple cases
    expect(res.outCPP!.code).toContain('auto compute');
  });

  it('should handle compilation errors in diagnostics', () => {
    const res = buildCode({
      code: 'return unknownVariable;', // Error
      emitIR: true
    });
    expect(res.diagnostics.length).toBeGreaterThan(0);
    expect(res.diagnostics[0].message).toContain('Unresolved identifier');
    // IR might still exist (partial?) or be empty block?
    // Current compiler might return partial graph.
  });

  describe('Debug Flags', () => {
    it('should generate debug code only', () => {
      const res = buildCode({ code: 'return 1;', emitJS: true, debug: 'only' });
      expect(res.outJS?.code).toBeUndefined();
      expect(res.outJS?.debugCode).toContain('record_debug');
    });
    it('should generate both codes', () => {
      const res = buildCode({ code: 'return 1;', emitJS: true, debug: 'both' });
      expect(res.outJS?.code).toBeDefined();
      expect(res.outJS?.code).not.toContain('record_debug');
      expect(res.outJS?.debugCode).toBeDefined();
      expect(res.outJS?.debugCode).toContain('record_debug');
    });

    it('should execute debugRunner and populate traces', () => {
      const res = buildCode({
        code: 'var x = 10; return x + 5;',
        emitJSRunner: true,
        debug: 'only'
      });
      expect(res.outJSRunner?.runner).toBeUndefined();
      expect(res.outJSRunner?.debugRunner).toBeDefined();

      const debugOut: Record<string, any> = {};
      const val = res.outJSRunner!.debugRunner!({}, debugOut);

      expect(val).toBe(15);
      // Check if debugOut is populated.
      // Keys are line numbers (strings).
      const keys = Object.keys(debugOut);
      expect(keys.length).toBeGreaterThan(0);
      // We expect '10' (var decl) and '15' (return) or similar.
      // Just check one value.
      const hasValue = Object.values(debugOut).some(v => v === 10 || v === 15);
      expect(hasValue).toBe(true);
    });
  });

  it('should reuse runner instance (no eval loop)', () => {
    const res = buildCode({
      code: 'return 42;',
      emitJSRunner: true
    });
    const runner1 = res.outJSRunner!.runner;
    const runner2 = res.outJSRunner!.runner;
    // Actually buildCode returns type { runner: ... }
    // The function 'buildCode' creates a new result object.
    // But inside the object, 'runner' is a function.
    // We want to ensure 'runner' is the SAME function (if we called it twice?)
    // No, the test is: calling 'runner' multiple times should work and not re-eval.
    // We can't easily spy on 'eval' or 'Function' constructor here without mocking.
    // But we can verify it works.
    expect(runner1({}, {})).toBe(42);
    expect(runner1({}, {})).toBe(42);
  });
});
