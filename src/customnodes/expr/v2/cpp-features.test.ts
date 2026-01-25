import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { generateCPP } from './codegen-cpp';
import { DataTypeKind, PrimitiveType } from './ir-types';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };

// Helpers
const TMP_DIR = path.resolve(__dirname, '../../../../tmp');

function runCPP(code: string, input: any): any {
  const filename = `feat_test_${Date.now()}_${Math.floor(Math.random() * 1000)}.cpp`;
  const cppPath = path.join(TMP_DIR, filename);
  const exePath = path.join(TMP_DIR, filename.replace('.cpp', '.out'));

  if (!fs.existsSync(path.join(TMP_DIR, 'json.hpp'))) {
    throw new Error("json.hpp not found in tmp/");
  }

  fs.writeFileSync(cppPath, code);

  try {
    execSync(`clang++ -std=c++17 "${cppPath}" -o "${exePath}"`, { stdio: 'inherit' });
  } catch (e) {
    throw new Error(`Compilation failed: ${e}`);
  }

  try {
    const inputStr = JSON.stringify({ inputs: input });
    const res = execSync(`"${exePath}"`, { input: inputStr, encoding: 'utf-8' });
    const json = JSON.parse(res);
    if (json.debug) json.outputs._debug = json.debug;
    return json.outputs;
  } catch (e) {
    throw new Error(`Execution failed: ${e}`);
  }
}

function compileToCpp(src: string, inputValues: any, options: any = {}): string {
  const inputs: Record<string, any> = {};
  for (const k in inputValues) {
    if (typeof inputValues[k] === 'number') inputs[k] = NUMBER_TYPE;
    // Add other types as needed
  }
  const ir = compileToIR(src, inputs);
  return generateCPP(ir, { inputs, ...options });
}

describe('C++ Advanced Features (Mutation & Inlining)', () => {

  it('should mutate array elements', () => {
    const src = `
        let arr = [1, 2, 3];
        arr[0] = 10;
        return arr[0];
    `;
    const cpp = compileToCpp(src, {});
    const res = runCPP(cpp, {});
    expect(res.res).toBe(10);
  }, 30000);

  it('should mutate struct properties', () => {
    const src = `
        let p = { x: 1, y: 2 };
        p.x = 100;
        return p.x + p.y;
    `;
    const cpp = compileToCpp(src, {});
    const res = runCPP(cpp, {});
    expect(res.res).toBe(102);
  }, 30000);

  it('should mutate nested properties (L-Value Chaining)', () => {
    const src = `
        let arr = [{ x: 1 }, { x: 2 }];
        arr[0].x = 50;
        return arr[0].x + arr[1].x;
    `;
    const cpp = compileToCpp(src, {});
    const res = runCPP(cpp, {});
    expect(res.res).toBe(52); // 50 + 2
  }, 30000);

  it('should support compound assignment on properties', () => {
    const src = `
          let p = { val: 10 };
          p.val += 5;
          return p.val;
      `;
    const cpp = compileToCpp(src, {});
    const res = runCPP(cpp, {});
    expect(res.res).toBe(15);
  }, 30000);

  it('should inline helper functions', () => {
    const src = `
          function add(a, b) { return a + b; }
          return add(10, 20);
      `;
    const cpp = compileToCpp(src, {});
    const res = runCPP(cpp, {});
    expect(res.res).toBe(30);
  }, 30000);
});
