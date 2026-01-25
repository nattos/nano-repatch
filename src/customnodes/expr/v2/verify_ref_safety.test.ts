import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { DiagnosticSeverity } from './ir-types';

describe('Reference Safety & Unsupported Diagnostics', () => {

  it('should allow valid linear reassignment (Inlining)', () => {
    const src = `
            interface Vec { x: number }
            let arr = [{x:1}, {x:2}];
            let b = arr[0]; // Alias created
            b = arr[1];     // Reassignment to new expression
            // This is valid: 'b' just points to new expr.
        `;
    const ir = compileToIR(src, {});
    // Should NOT error
    const error = ir.diagnostics?.find(d => d.severity === DiagnosticSeverity.Error);
    expect(error).toBeUndefined();
  });

  it('should diagnose mutation of Phi values (Lost Reference)', () => {
    const src = `
            interface Vec { x: number }
            let arr = [{x:1}, {x:2}];
            let b = arr[0];
            let k = 1; // runtime? No, k=1 is const.
            // We need unknown.
            // compileToIR second arg is globals.
            if (dynamic_cond) {
                b = arr[1];
            }
            // 'b' is Phi.
            b.x = 10; // Modifies Copy!
        `;
    const ir = compileToIR(src, { dynamic_cond: { kind: 'primitive', name: 'boolean' } as any });
    // Should warn/error about mutation of Phi/Value which is not an Alias
    const warning = ir.diagnostics?.find(d => d.message.includes('Mutation of Phi value'));
    expect(warning).toBeDefined();
  });

  it('should allow local struct mutation', () => {
    const src = `
            let v = { x: 1 };
            v.x = 2; // Valid local mutation
        `;
    const ir = compileToIR(src, {});
    expect(ir.diagnostics?.filter(d => d.severity === DiagnosticSeverity.Error).length).toBe(0);
    // Warning should also be 0 ideally.
  });
});
