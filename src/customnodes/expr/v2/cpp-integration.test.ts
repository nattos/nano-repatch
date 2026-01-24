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
});
