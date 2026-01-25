import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { generateCPP } from './codegen-cpp';
import { DataTypeKind, PrimitiveType } from './ir-types';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };

// Helpers to run C++
const TMP_DIR = path.resolve(__dirname, '../../../../tmp');

function runCPP(code: string, input: any): any {
  const filename = `test_${Date.now()}.cpp`;
  const cppPath = path.join(TMP_DIR, filename);
  const exePath = path.join(TMP_DIR, filename.replace('.cpp', '.out'));

  // Ensure json.hpp exists in TMP_DIR
  if (!fs.existsSync(path.join(TMP_DIR, 'json.hpp'))) {
    throw new Error("json.hpp not found in tmp/");
  }

  fs.writeFileSync(cppPath, code);

  // Compile
  try {
    execSync(`clang++ -std=c++17 "${cppPath}" -o "${exePath}"`, { stdio: 'inherit' });
  } catch (e) {
    throw new Error(`Compilation failed: ${e}`);
  }

  // Run
  try {
    const inputStr = JSON.stringify({ inputs: input });
    // echo input | ./exe
    const res = execSync(`"${exePath}"`, { input: inputStr, encoding: 'utf-8' });
    // Parse output
    const json = JSON.parse(res);
    return json.outputs;
  } catch (e) {
    throw new Error(`Execution failed: ${e}`);
  } finally {
    // Cleanup?
    // fs.unlinkSync(cppPath);
    // fs.unlinkSync(exePath);
  }
}

function compileToCpp(src: string, inputValues: any): string {
  const inputs: Record<string, any> = {};
  for (const k in inputValues) {
    if (typeof inputValues[k] === 'number') inputs[k] = NUMBER_TYPE;
    if (typeof inputValues[k] === 'boolean') inputs[k] = { kind: DataTypeKind.Primitive, name: 'boolean' };
  }
  const ir = compileToIR(src, inputs);
  return generateCPP(ir, { inputs });
}

describe('C++ Backend Integration', () => {

  it('should compile and run basic math (Ex 1)', () => {
    const source = 'return x + y;';
    const inputs = { x: NUMBER_TYPE, y: NUMBER_TYPE };

    const ir = compileToIR(source, inputs);

    const cpp = generateCPP(ir, { inputs, outputType: NUMBER_TYPE });

    const res = runCPP(cpp, { x: 10, y: 32 });
    expect(res.res).toBe(42);
  });

  it('should run loops (Ex 4 Loop)', () => {
    // Ex 4: Simulation loop
    // let x = 0; for(let i=0; i<3; i++) x = x + step; return x;
    const source = `
          let x = 0;
          for (let i = 0; i < 3; i++) {
             x = x + step;
          }
          return x;
        `;
    const inputs = { step: NUMBER_TYPE };
    const ir = compileToIR(source, inputs);
    const cpp = generateCPP(ir, { inputs, outputType: NUMBER_TYPE });

    const res = runCPP(cpp, { step: 2 });
    expect(res.res).toBe(6); // 0 + 2 + 2 + 2
  });

  it('should run convolution (Ex 6 Array)', () => {
    // Ex 6 with runtime signal
    // kernel is constant for simplicity, or can be input too.
    // Let's make signal an input.
    const source = `
       const kernel = [0.5, 1];
       let result: number[] = [];
       // signal is input array of size 5
       // Convolve:
       // i=0: signal[0]*0.5 + signal[1]*1
       // i=1: signal[1]*0.5 + signal[2]*1
       // i=2: signal[2]*0.5 + signal[3]*1
       // i=3: signal[3]*0.5 + signal[4]*1

       for (let i = 0; i < 4; i++) {
          let sum = 0;
          for (let j = 0; j < 2; j++) {
             // We need to use 'signal' which is external
             sum = sum + signal[i+j] * kernel[j];
          }
          result.push(sum);
       }
       return result;
     `;
    const ARRAY_NUM = { kind: DataTypeKind.Array, elementType: NUMBER_TYPE } as any;
    const inputs = { signal: ARRAY_NUM };

    const ir = compileToIR(source, inputs);

    const cpp = generateCPP(ir, { inputs, outputType: ARRAY_NUM });

    const signalData = [1, 2, 3, 4, 5];
    const res = runCPP(cpp, { signal: signalData });

    // Expected:
    // 1*0.5 + 2*1 = 2.5
    // 2*0.5 + 3*1 = 4.0
    // 3*0.5 + 4*1 = 5.5
    // 4*0.5 + 5*1 = 7.0
    expect(res.res).toEqual([2.5, 4.0, 5.5, 7.0]);
  });

  it('should run Math intrinsics', () => {
    const source = `
        let val = x;
        val = Math.sin(val);
        val = Math.pow(val, 2);
        val = Math.max(val, 0.5);
        return val;
      `;
    // x = PI/2 => sin(PI/2) = 1 => 1^2 = 1 => max(1, 0.5) = 1
    // x = 0 => sin(0) = 0 => 0^2 = 0 => max(0, 0.5) = 0.5

    const inputs = { x: NUMBER_TYPE };
    const ir = compileToIR(source, inputs);
    const cpp = generateCPP(ir, { inputs, outputType: NUMBER_TYPE });

    const res1 = runCPP(cpp, { x: Math.PI / 2 });
    expect(Math.abs(res1.res - 1.0)).toBeLessThan(0.0001);

    const res2 = runCPP(cpp, { x: 0 });
    expect(res2.res).toBe(0.5);
  });

  it('should run struct ops', () => {
    // Input: { pos: { x: 1, y: 2 } }
    // Output: { x: 2, y: 4 }
    const source = `
        const s = pos;
        return { x: s.x * 2, y: s.y * 2 };
     `;
    const VEC2_TYPE = {
      kind: DataTypeKind.Struct,
      fields: { x: NUMBER_TYPE, y: NUMBER_TYPE }
    } as any;

    const inputs = { pos: VEC2_TYPE };
    const ir = compileToIR(source, inputs); // Need to verify compileToIR supports struct literal emission

    const cpp = generateCPP(ir, { inputs, outputType: VEC2_TYPE });
    // Expect compilation failure due to "Struct" type name placeholder

    const res = runCPP(cpp, { pos: { x: 1, y: 2 } });
    expect(res.res.x).toBe(2);
    expect(res.res.y).toBe(4);
  });

  it('should compile optional input fields', () => {
    const src = `
        interface VecOpt {
            x: number;
            y?: number;
        }
        // Input passed as JSON
        // If y is present, return it. Else return 0.
        // C++ backend needs to map VecOpt to struct with optional.

        let v: VecOpt = { x: 1 }; // Placeholder init to get type inference if inputs not explicit?

        // Actually inputs are passed to generateCPP.
        // We need to define input type.
        // Just use 'input' var to access top level input?
        // The test harness passes { x:1, y:2 } or { x:1 }.
        // Logic:
        input.y; // Should return optional access?
        // Wait, 'input' is treated as a struct in C++ codegen.
        // If we define input as VecOpt.

        // Let's use var decl flow:
        // Main input struct is generated from 'inputs' map.
      `;
    // We pass explicit globals to compileToIR which defines 'input' type
    const inputType = {
      kind: DataTypeKind.Struct,
      name: 'InputStruct',
      fields: {
        x: NUMBER_TYPE,
        y: { kind: DataTypeKind.Union, types: [NUMBER_TYPE, { kind: DataTypeKind.Primitive, name: 'undefined' }] }
      }
    };
    // Manually construct IR? Or just compile with globals?
    // IR Spec: 'input' is a global var.
    // But codegen treats it special?
    // codegen uses `options.inputs` to generate Input struct definition.

    const ir = compileToIR(`
        let res = 0;
        // Check if y (optional) has value?
        // IR Simplification: Just access it.
        // If we access 'input.y', in C++ it returns optional.
        // We can't use it directly in math yet without manual unwrap logic in codegen or user logic.
        // But we can return it!
        // Output type: optional<number>.

        // This test verifies compilation of the struct definition primarily.
        return input.y;
      `, { input: inputType as any });

    const cpp = generateCPP(ir, {
      inputs: { input: inputType as any },
      outputType: inputType.fields.y as any // Output is optional<double>
    });

    // Case 1: Present
    const res1 = runCPP(cpp, { input: { x: 1, y: 100 } });
    expect(res1.res).toBe(100);

    // Case 2: Missing
    const res2 = runCPP(cpp, { input: { x: 1 } });
    expect(res2.res).toBe(null); // JSON null for missing optional
  });

  it('should compile dynamic function dispatch (inlining)', () => {
    // Tests if `let f = cond ? A : B; f()` works in C++ via full inlining/unrolling
    const src = `
      // Input: "mode" (number)
      // Logic:
      const add = (a: number) => a + 10;
      const mul = (a: number) => a * 10;

      let f = add;
      if (input.mode > 0) {
          f = mul;
      }

      return f(5);
    `;
    // If mode > 0: 5*10=50. Else 5+10=15.

    // Globals/Inputs
    const INPUT_TYPE = { kind: DataTypeKind.Struct, fields: { mode: NUMBER_TYPE } };

    const ir = compileToIR(src, { input: INPUT_TYPE as any });
    const cpp = generateCPP(ir, {
      inputs: { input: INPUT_TYPE as any },
      outputType: NUMBER_TYPE
    });

    // Case A: Mode 0 -> Add
    const resA = runCPP(cpp, { input: { mode: 0 } });
    expect(resA.res).toBe(15);

    // Case B: Mode 1 -> Mul
    const resB = runCPP(cpp, { input: { mode: 1 } });
    expect(resB.res).toBe(50);
  }, 15000);

  it('should run unary ops', () => {
    const src = `
        interface In { x: number; b: boolean; }
        const neg = -x;
        const notNull = !b;
        if (notNull) return neg;
        return 0;
    `;
    const cpp = compileToCpp(src, { x: 10, b: false });
    // b is false -> notNull is true -> return neg (-10)
    const res = runCPP(cpp, { x: 10, b: false });
    expect(res.res).toBe(-10);

    const res2 = runCPP(cpp, { x: 10, b: true });
    expect(res2.res).toBe(0);
  }, 30000);
});
