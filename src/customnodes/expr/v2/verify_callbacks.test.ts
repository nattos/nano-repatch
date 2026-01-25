import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { DiagnosticSeverity } from './ir-types';

describe('Dictionary Callbacks & Mixed Structs', () => {

  it('should support passing lambdas in mixed structs (Callbacks)', () => {
    const src = `
            // Helper function expecting a dictionary of callbacks and values
            function process(opts: { onStart: () => number, val: number }) {
                const x = opts.onStart(); // Call lambda
                return x + opts.val;      // Use dynamic val
            }

            // Usage
            const cb = () => 42;
            // Mixed struct: 'onStart' is Const (Lambda), 'val' is Dynamic (Input)
            // dynamic_input global
            const result = process({ onStart: cb, val: dynamic_input });
        `;

    // This requires 'process' to be inlined.
    // Inside 'process':
    // 'opts' is a VarNode (Argument).
    // 'opts.onStart' is PropAccess(opts, 'onStart').
    // If we don't resolve 'opts' value from the caller (Const/Struct), we can't see the lambda.
    // Inter-procedural Constant Folding.

    const ir = compileToIR(src, { dynamic_input: { kind: 'primitive', name: 'number' } as any });

    // Should compile without error
    const error = ir.diagnostics?.find(d => d.severity === DiagnosticSeverity.Error);
    expect(error).toBeUndefined();
  });

  it('should support inline object literals as arguments', () => {
    const src = `
             function run(ops: { f: (x:number)=>number }) {
                 return ops.f(10);
             }
             const res = run({ f: (x) => x * 2 });
         `;
    const ir = compileToIR(src, {});
    const error = ir.diagnostics?.find(d => d.severity === DiagnosticSeverity.Error);
    expect(error).toBeUndefined();
  });
});
