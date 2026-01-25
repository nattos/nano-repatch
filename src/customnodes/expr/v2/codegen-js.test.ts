import { describe, it, expect } from 'vitest';
import { compileToIR, CompilerOptions } from './compiler';
import { generateJS } from './codegen-js';
import { DataTypeKind, DataType } from './ir-types';

function runJS(code: string, inputs: any) {
  // Strip module.exports
  const body = code.replace('module.exports = { compute };', 'return compute;');
  // Create function
  const factory = new Function(body);
  const compute = factory();
  return compute(inputs);
}

const opts: CompilerOptions = {
  allowUnresolved: false
};

describe('JS Codegen Verification', () => {

  it('should compile and run basic math', () => {
    const ir = compileToIR('return 40 + 2;', opts);
    const js = generateJS(ir, { inputs: {} });
    const res = runJS(js, {});
    expect(res).toBe(42);
  });

  it('should handle logic ops', () => {
    const ir = compileToIR('return (true && false) || true;', opts);
    const js = generateJS(ir, { inputs: {} });
    expect(runJS(js, {})).toBe(true);
  });

  it('should handle unary ops', () => {
    const ir = compileToIR('return -42;', opts);
    const js = generateJS(ir, { inputs: {} });
    expect(runJS(js, {})).toBe(-42);

    // Not
    const ir2 = compileToIR('return !true;', opts);
    expect(runJS(generateJS(ir2, { inputs: {} }), {})).toBe(false);
  });

  it('should handle variables', () => {
    const ir = compileToIR('return x * 2;', opts);
    // Need to define inputs in CodeGenOptions so it knows x is input
    const inputs = { x: { kind: DataTypeKind.Primitive, name: 'number' } as DataType };
    const js = generateJS(ir, { inputs });
    expect(runJS(js, { x: 21 })).toBe(42);
  });

  it('should handle if statements', () => {
    const code = `
      if (x > 10) {
        return 1;
      } else {
        return 0;
      }
    `;
    const ir = compileToIR(code, opts);
    const inputs = { x: { kind: DataTypeKind.Primitive, name: 'number' } as DataType };
    const js = generateJS(ir, { inputs });

    expect(runJS(js, { x: 11 })).toBe(1);
    expect(runJS(js, { x: 5 })).toBe(0);
  });

  it('should handle loops (while)', () => {
    const code = `
       let i = 0;
       while (i < 5) {
         i = i + 1;
       }
       return i;
     `;
    const ir = compileToIR(code, opts);
    const js = generateJS(ir, { inputs: {} });
    expect(runJS(js, {})).toBe(5);
  });

  it('should handle array operations', () => {
    const code = `
        let arr = [1, 2, 3];
        arr.push(4);
        return arr[3]; // should be 4
      `;
    const ir = compileToIR(code, opts);
    const js = generateJS(ir, { inputs: {} });
    expect(runJS(js, {})).toBe(4);
  });

  it('should perform Reference Sharing for mutable aliasing', () => {
    const code = `
        let p1 = { x: 1, y: 1 };
        let p2 = p1; // Alias (Ref)
        p2.x = 10;
        return p1.x; // Becomes 10
      `;
    const ir = compileToIR(code, opts);
    const js = generateJS(ir, { inputs: {} });
    const res = runJS(js, {});
    expect(res).toBe(10);
  });

  it('should perform Reference Sharing for nested struct', () => {
    const code = `
         let a = { p: { x: 1 } };
         let b = a;
         b.p.x = 10;
         return a.p.x; // Becomes 10
      `;
    const ir = compileToIR(code, opts);
    const js = generateJS(ir, { inputs: {} });
    expect(runJS(js, {})).toBe(10);
  });

  it('should perform Reference Sharing for array', () => {
    const code = `
        let a = [1, 2];
        let b = a;
        b[0] = 10;
        return a[0]; // Becomes 10
      `;
    const ir = compileToIR(code, opts);
    const js = generateJS(ir, { inputs: {} });
    expect(runJS(js, {})).toBe(10);
  });

  it('should handle Math intrinsics', () => {
    const code = `return Math.min(10, 2);`;
    const ir = compileToIR(code, opts);
    const js = generateJS(ir, { inputs: {} });
    expect(runJS(js, {})).toBe(2);
  });

});
