import { describe, it, expect, beforeAll, vi } from 'vitest';
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
  const id = Math.random().toString(36).substring(7);
  const filename = `ref_test_${Date.now()}_${id}.cpp`;
  const cppPath = path.join(TMP_DIR, filename);
  const exePath = path.join(TMP_DIR, filename.replace('.cpp', '.out'));

  if (!fs.existsSync(path.join(TMP_DIR, 'json.hpp'))) {
    throw new Error("json.hpp not found in tmp/");
  }

  try {
    fs.writeFileSync(cppPath, code);
    execSync(`clang++ -std=c++17 "${cppPath}" -o "${exePath}"`, { stdio: 'ignore' });
  } catch (e) {
    throw new Error(`Compilation failed: ${e}`);
  }

  try {
    const inputStr = JSON.stringify({ inputs: input });
    const res = execSync(`"${exePath}"`, { input: inputStr, encoding: 'utf-8' });
    const json = JSON.parse(res);
    return json.outputs;
  } catch (e) {
    throw new Error(`Execution failed: ${e}`);
  } finally {
    if (fs.existsSync(cppPath)) fs.unlinkSync(cppPath);
    if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
  }
}

describe('Reference Tracking & Aliasing', () => {
  beforeAll(() => {
    vi.setConfig({ testTimeout: 60000 });
  });

  it('should treat struct variable assignment as alias (reference semantics)', () => {
    const src = `
        interface S { x: number; }
        let s = { x: 0 };
        let r = s; // Should alias r -> s
        r.x = 10;
        return s.x; // Should be 10 if aliased, 0 if copied.
    `;
    const ir = compileToIR(src, {});
    const cpp = generateCPP(ir, { inputs: {}, outputType: NUMBER_TYPE });
    const res = runCPP(cpp, {});
    expect(res.res).toBe(10);
  });

  it('should alias nested reference access', () => {
    // let b = balls[i]; b.x = 5;
    const src = `
        interface Vec2 { x: number; y: number; }
        let arr = [{x:0, y:0}, {x:10, y:10}]; // let for mutable array

        for (let i = 0; i < 2; i++) {
            let v = arr[i]; // Alias v -> arr[i]
            v.x = v.x + 100;
        }
        return arr[0].x; // Should be 100
    `;
    const ir = compileToIR(src, {});
    const cpp = generateCPP(ir, { inputs: {}, outputType: NUMBER_TYPE });
    const res = runCPP(cpp, {});
    expect(res.res).toBe(100);
  });

  it('should propagate references across function calls', () => {
    const src = `
        interface S { x: number; }

        function modify(p: S) {
            p.x = p.x + 20;
        }

        let s = { x: 10 };
        modify(s); // Should pass 's' by reference (inline)
        return s.x;
    `;
    const ir = compileToIR(src, {});
    const cpp = generateCPP(ir, { inputs: {}, outputType: NUMBER_TYPE });
    const res = runCPP(cpp, {});
    expect(res.res).toBe(30);
  });
});
