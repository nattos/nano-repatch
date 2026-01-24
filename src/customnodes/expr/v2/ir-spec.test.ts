import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { OpKind, DataTypeKind, PrimitiveType, IRNode } from './ir-types';

const EX_BASIC = `
  let x = 10;
  let y = 0;
  if (x > 5) {
    y = x * 2;
  } else {
    y = x + 1;
  }
  y;
`;

// Helper for Type assertions
const isNumber = (t: any) => t.kind === DataTypeKind.Primitive && t.name === 'number';
const isArrayOfNumber = (t: any) => t.kind === DataTypeKind.Array && (t.elementType.kind === DataTypeKind.Any || isNumber(t.elementType));

describe('IR Specification (Integration)', () => {

  it('should compile basic math with constant folding (Ex 1)', () => {
    const ir = compileToIR(EX_BASIC);
    const block = ir.root as any;
    const lastStmt = block.statements[block.statements.length - 1];

    // Constant Folding works
    expect(lastStmt.kind).toBe(OpKind.Const);
    expect(lastStmt.value).toBe(20);
    expect(isNumber(lastStmt.type)).toBe(true);
  });

  it('should unroll array map/reduce (Ex 2)', () => {
    const EX_ARRAYS = `
      const data = [1, 2, 3, 4];
      const scaled = data.map(v => v * 10);
      const sum = scaled.reduce((acc, v) => acc + v, 0);
      sum;
    `;
    const ir = compileToIR(EX_ARRAYS);

    const block = ir.root as any;
    const lastStmt = block.statements[block.statements.length - 1];

    // 10+20+30+40 = 100
    expect(lastStmt.kind).toBe(OpKind.Const);
    expect(lastStmt.value).toBe(100);
    expect(isNumber(lastStmt.type)).toBe(true);
  });

  it('should handle structs and property access (Ex 3 simplified)', () => {
    const EX_STRUCTS = `
      const v1 = { x: 10, y: 20 };
      const z = v1.x + v1.y;
      z;
    `;
    const ir = compileToIR(EX_STRUCTS);

    const block = ir.root as any;
    const lastStmt = block.statements[block.statements.length - 1];

    // v1.x (10) + v1.y (20) = 30
    expect(lastStmt.kind).toBe(OpKind.Const);
    expect(lastStmt.value).toBe(30);
    expect(isNumber(lastStmt.type)).toBe(true);
  });

  it('should inline generic functions (Ex 3 Generics)', () => {
    const EX_GENERICS = `
      interface Vector2 {
        x: number;
        y: number;
      }

      function add<T extends {x: number, y: number}>(a: T, b: T): T {
        return { ...a, x: a.x + b.x, y: a.y + b.y };
      }

      const v1 = { x: 1, y: 2 };
      const v2 = { x: 3, y: 4 };
      const v3 = add(v1, v2);
      v3.x;
    `;
    const ir = compileToIR(EX_GENERICS);

    // Expected:
    // v1, v2 are Compile-time Constants (Structs)
    // add(v1, v2) is inlined:
    //   T is inferred as the Struct Type of v1/v2
    //   Body executes: { ...a, x: 1+3, y: 2+4 } -> { ..., x:4, y:6 }
    //   Returns Const Struct { x: 4, y: 6 }
    // v3.x -> 4

    const block = ir.root as any;
    const lastStmt = block.statements[block.statements.length - 1];

    expect(lastStmt.kind).toBe(OpKind.Const);
    expect(lastStmt.value).toBe(4);
    expect(isNumber(lastStmt.type)).toBe(true);
  });

  it('should handle function overloads (Ex 7)', () => {
    const EX_OVERLOADS = `
      function double(val: number): number {
        return val * 2;
      }
      // Overload simplified pattern using Union Type check

      function doublePoly(val: number | number[]) {
         if (Array.isArray(val)) {
           return val.map(v => v * 2);
         } else {
           return val * 2;
         }
      }

      const r1 = doublePoly(10);
      const r2 = doublePoly([1, 2]);

      r1;
      r2;
    `;
    // Note: The original Ex 7 used explicit overloads signatures + implementation.
    // Our compiler should handle the implementation body unrolling correctly based on the input type.
    // Array.isArray(10) -> false (Const)
    // Array.isArray([1,2]) -> true (Const)
    // So Dead Code Elimination should pick the right path!

    // Actually, this just tests "Dead Code Elimination" + "Type Guards" + "Array checks".
    // Does it test "Overloads"?
    // True overloads dispatch based on signature matching.
    // But in TS, the implementation is single.
    // So if I implement 'IsArray' folding, this should work "for free" with current architecture?

    const ir = compileToIR(EX_OVERLOADS);
    const block = ir.root as any;

    // We expect the code to fold to:
    // r1 = 20
    // r2 = [2, 4]
    // The last two statements in the block should be the ExpressionStatements for r1 and r2.
    // However, depending on how VarDecl is emitted, we might look for the Declarations or the final expressions.

    // The code ends with:
    // r1;
    // r2;
    // These are expression statements.

    const len = block.statements.length;
    // Statements are line-by-line compilations.
    // r1; -> expression statement (Const Node)
    // r2; -> expression statement (Const Node)

    const lastStmt = block.statements[len - 1]; // r2
    const secondLastStmt = block.statements[len - 2]; // r1

    expect(secondLastStmt.kind).toBe(OpKind.Const);
    expect(secondLastStmt.value).toBe(20);
    expect(isNumber(secondLastStmt.type)).toBe(true);

    expect(lastStmt.kind).toBe(OpKind.Const);
    expect(lastStmt.value).toEqual([2, 4]);
    expect(isArrayOfNumber(lastStmt.type)).toBe(true);
  });

  it('should fold Type Guards in function body (Ex 7 Realized)', () => {
    const CODE_SCALAR = `
          function doublePoly(val: any) {
             if (Array.isArray(val)) {
               return 0; // Dummy array path
             } else {
               return val * 2;
             }
          }
          doublePoly(10);
      `;
    const ir1 = compileToIR(CODE_SCALAR);
    const last1 = (ir1.root as any).statements.slice(-1)[0];
    expect(last1.kind).toBe(OpKind.Const);
    expect(last1.value).toBe(20);
    expect(isNumber(last1.type)).toBe(true);

    const CODE_ARRAY = `
          function doublePoly(val: any) {
             if (Array.isArray(val)) {
               return val.map(v => v * 2);
             } else {
               return val * 2;
             }
          }
          doublePoly([1, 2]);
      `;
    const ir2 = compileToIR(CODE_ARRAY);
    const last2 = (ir2.root as any).statements.slice(-1)[0];
    expect(last2.kind).toBe(OpKind.Const);
    // [2, 4]
    expect(last2.value).toEqual([2, 4]);
    expect(isArrayOfNumber(last2.type)).toBe(true);
    expect(last2.value).toEqual([2, 4]);
    expect(isArrayOfNumber(last2.type)).toBe(true);
  });

  it('should reflect generic types in the output (Ex 8)', () => {
    const EX_REFLECTION = `
        interface Wrapper<T> {
            value: T;
        }

        function box<T>(val: T): Wrapper<T> {
            return { value: val };
        }

        const w1 = box(10);
        const w2 = box([1, 2]);
        w1;
        w2;
      `;

    const ir = compileToIR(EX_REFLECTION);
    const block = ir.root as any;
    const len = block.statements.length;

    const w1Expr = block.statements[len - 2];
    const w2Expr = block.statements[len - 1];

    // w1.value == 10
    expect(w1Expr.kind).toBe(OpKind.Const);
    expect(w1Expr.value).toEqual({ value: 10 });

    // w1 Type should be GenericInstantiation: Wrapper<number>
    const t1 = w1Expr.type;
    expect(t1.kind).toBe(DataTypeKind.GenericInstantiation);
    expect(t1.base).toBe('Wrapper');
    expect(t1.args[0].kind).toBe(DataTypeKind.Primitive);
    expect(t1.args[0].name).toBe('number');

    // w2.value == [1, 2]
    expect(w2Expr.kind).toBe(OpKind.Const);
    expect(w2Expr.value).toEqual({ value: [1, 2] });

    // w2 Type should be GenericInstantiation: Wrapper<number[]>
    const t2 = w2Expr.type;
    expect(t2.kind).toBe(DataTypeKind.GenericInstantiation);
    expect(t2.base).toBe('Wrapper');
    expect(t2.args[0].kind).toBe(DataTypeKind.Array);
    expect(t2.base).toBe('Wrapper');
    expect(t2.args[0].kind).toBe(DataTypeKind.Array);
  });

  it('should handle conditional assignment of lambdas (Ex 5 Dynamic)', () => {
    const EX_DYN = `
        // We simulate a dynamic condition with a function parameter or external logic
        // But since we control the source, let's treat a global 'mode' as dynamic Var (VarNode)

        let op;
        if (check_mode > 0) { // 'check_mode' unresolved -> VarNode (Dynamic)
            op = (x) => x + 1;
        } else {
            op = (x) => x * 10;
        }

        const res = op(5);
        res;
      `;

    const ir = compileToIR(EX_DYN);
    const block = ir.root as any;
    const lastStmt = block.statements[block.statements.length - 1]; // res

    // Expected IR Structure:
    // It should NOT be a Const. It should be a conditional expression.
    // Or an If/Phi structure.
    // Since our IR is statement based, 'res' computation might be:
    // If(check_mode > 0, res = 6, res = 50)
    // Then last stmt is 'res' (VarNode) ?
    // OR if we support Phi nodes as values:
    // res = Phi(check_mode > 0, 6, 50)

    // Our compiler unrolls statements.
    // If we merge scopes:
    // op = Phi(cond, f1, f2)
    // Call(op, 5) -> Inlines both? -> Phi(cond, inline(f1,5), inline(f2,5))
    // -> Phi(cond, 6, 50)

    // So last stmt should be a PhiNode (if it's an expression) or it refers to a variable holding a PhiNode?
    // compileToIR returns the Block. The 'statements' list.
    // If 'res' is a const variable holding a PhiNode...

    // Let's assert on the value structure.

    expect(lastStmt.kind).toBe(OpKind.Phi);
    const phi = lastStmt as any;
    // True path: x+1 = 6
    expect(phi.trueValue.kind).toBe(OpKind.Const);
    expect(phi.trueValue.value).toBe(6);

    // False path: x*10 = 50
    expect(phi.falseValue.kind).toBe(OpKind.Const);
    expect(phi.falseValue.value).toBe(50);
    expect(phi.falseValue.value).toBe(50);
  });

  // Expected to fail: ForStatement not implemented
  it('should compile simulation loop (Ex 4)', () => {
    const EX_SIM = `
        let particles = [];
        let r = 0;
        // Simple loop unrolling
        for (let i = 0; i < 3; i++) {
            particles.push({ x: i * 10 });
            r = r + 1;
        }
        r;
      `;
    const ir = compileToIR(EX_SIM);
    const block = ir.root as any;
    const last = block.statements[block.statements.length - 1]; // r

    // r should be 3
    expect(last.kind).toBe(OpKind.Const);
    expect(last.value).toBe(3);
  });

  // Expected to fail: ForStatement + Array Access
  it('should compile convolution (Ex 6)', () => {
    const EX_CONV = `
        const signal = [1, 2, 3, 4, 5];
        const kernel = [0.5, 0.5];
        let output = [];

        for (let i = 0; i < 4; i++) {
            // output[i] = signal[i] * k[0] + signal[i+1] * k[1]
            let val = signal[i] * kernel[0] + signal[i+1] * kernel[1];
            output.push(val);
        }
        output;
      `;
    const ir = compileToIR(EX_CONV);
    const block = ir.root as any;
    const last = block.statements[block.statements.length - 1];

    // Expected: [1.5, 2.5, 3.5, 4.5]
    expect(last.kind).toBe(OpKind.Const);
    expect(isArrayOfNumber(last.type)).toBe(true);
    expect(last.value).toEqual([1.5, 2.5, 3.5, 4.5]);
  });

});
