import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { DiagnosticSeverity } from './ir-types';

describe('Lambda & Dynamic Dispatch Limits', () => {

  it('should support Phi dispatch (Conditional Function)', () => {
    const src = `
            const f1 = (x: number) => x + 1;
            const f2 = (x: number) => x * 2;
            let res = 0;
            // dynamic_cond global
            if (dynamic_cond) {
                const f = f1;
                res = f(10);
            } else {
                const f = f2;
                res = f(10);
            }
            // Real Phi Dispatch
            const f_phi = dynamic_cond ? f1 : f2;
            res = f_phi(10);
        `;
    // Compiler has 'dispatchPhi' logic, so this *might* work currently.
    // We want to verify it doesn't crash or error if supported.
    const ir = compileToIR(src, { dynamic_cond: { kind: 'primitive', name: 'boolean' } as any });
    // Check for specific success or failure
  });

  it('should error on dynamic dispatch via Struct Field (Runtime)', () => {
    const src = `
            const f1 = () => 1;
            let obj = { f: f1 };

            // Mutation makes 'obj' dynamic (VarNode/StructNode logic changes?)
            // Actually, if we mutate it, we might lose track of 'f' being ConstNode.
            if (dynamic_cond) obj.f = f1;

            // Now calling obj.f()
            const x = obj.f();
        `;
    const ir = compileToIR(src, { dynamic_cond: { kind: 'primitive', name: 'boolean' } as any });

    // This fails to inline because 'obj.f' resolves to a PropAccess check at runtime,
    // effectively a function pointer. We don't support runtime func pointers.
    // Expect Error Diagnostic.
    const error = ir.diagnostics?.find(d => d.message.includes('Unsupported dynamic dispatch') || d.severity === DiagnosticSeverity.Error);
    expect(error).toBeDefined();
  });

  it('should support dispatch via Constant Struct Field', () => {
    const src = `
            const f1 = () => 42;
            const obj = { f: f1 }; // Fully constant
            const x = obj.f();
        `;
    const ir = compileToIR(src, {});
    // Should compile successfully (inlined)
    const error = ir.diagnostics?.find(d => d.severity === DiagnosticSeverity.Error);
    expect(error).toBeUndefined();
  });
});
