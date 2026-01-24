import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { OpKind, DataTypeKind } from './ir-types';

describe('Stress Tests & Advanced Features', () => {

  it('should capture closure variables in loops (Ex 10)', () => {
    // This tests if lambdas capture the value of 'i' at creation time.
    const CODE = `
      let funcs = [];
      for (let i = 0; i < 3; i++) {
          funcs.push(() => i);
      }

      const v0 = funcs[0]();
      const v1 = funcs[1]();
      const v2 = funcs[2]();

      v0; // Should be 0
      v1; // Should be 1
      v2; // Should be 2
    `;

    // NOTE: Current implementation does NOT support closures.
    // The lambda is just an AST node. When called, it looks up 'i' in the *call site* scope.
    // If 'i' is not in the call site scope, it might look up a global or fail.
    // In the unrolled loop, 'i' shadows the loop variable logic.
    // But once the loop finishes, 'i' might be gone or have the final value (3).
    // Actually, 'let i' in 'for' loop is block constrained?
    // In our unroller:
    //   Iterator 1: declares 'i' = 0. pushes lambda.
    //   Iterator 2: declares 'i' = 1. pushes lambda.
    //   ...
    //   After loop: 'i' is gone (scope popped).
    //   Call funcs[0](): lambda body `return i`.
    //   'i' is NOT in scope at call site!
    //   So this should fail with "Unresolved identifier: i".

    const ir = compileToIR(CODE);
    const block = ir.root as any;

    // Check results
    const stmts = block.statements;
    // v0 is stmts[len-3]
    // v1 is stmts[len-2]
    // v2 is stmts[len-1] (actually last stmt is expression statements if any)

    // With current logic, this will arguably fail compilation or produce incorrect result.

    const v0Expr = stmts.find((s: any) => s.kind === OpKind.VarDecl && s.name === 'v0')?.init;
    const v1Expr = stmts.find((s: any) => s.kind === OpKind.VarDecl && s.name === 'v1')?.init;
    const v2Expr = stmts.find((s: any) => s.kind === OpKind.VarDecl && s.name === 'v2')?.init;

    expect(v0Expr?.kind).toBe(OpKind.Const);
    expect((v0Expr as any).value).toBe(0);

    expect(v1Expr?.kind).toBe(OpKind.Const);
    expect((v1Expr as any).value).toBe(1);

    expect(v2Expr?.kind).toBe(OpKind.Const);
    expect((v2Expr as any).value).toBe(2);
  });

});
