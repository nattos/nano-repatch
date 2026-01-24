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
});
