import { describe, it, expect, vi, beforeAll } from 'vitest';
import { buildCode } from './builder';
import { DataTypeKind, DataType, PrimitiveType } from './ir-types';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { testCases, TestCase } from './backend-test-cases';

// --- Helpers ---

const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };

// JS Runner
function runJS(code: string, inputs: any, debug?: boolean) {
  const body = code.replace('module.exports = { compute };', 'return compute;');
  const factory = new Function(body);
  const compute = factory();
  const debugOut = debug ? {} : undefined;
  const res = compute(inputs, debugOut);
  // Return wrapper with debug if requested?
  if (debug) return { res, _debug: debugOut };
  return res;
}

// C++ Runner
const TMP_DIR = path.resolve(__dirname, '../../../../tmp');

function runCPP(code: string, input: any): any {
  if (!fs.existsSync(TMP_DIR)) {
    // Create tmp dir if missing (CI?)
    // Actually it usually exists.
  }

  const id = Math.random().toString(36).substring(7);
  const filename = `test_unified_${Date.now()}_${id}.cpp`;
  const cppPath = path.join(TMP_DIR, filename);
  const exePath = path.join(TMP_DIR, filename.replace('.cpp', '.out'));

  if (!fs.existsSync(path.join(TMP_DIR, 'json.hpp'))) {
    // throw new Error("json.hpp not found in tmp/");
    // Skip C++ tests if env not ready?
    return null;
  }

  try {
    fs.writeFileSync(cppPath, code);
    execSync(`clang++ -std=c++17 "${cppPath}" -o "${exePath}"`, { stdio: 'ignore' });
  } catch (e) {
    fs.writeFileSync(path.join(TMP_DIR, 'failed_rt.cpp'), code);
    throw new Error(`CPP Compilation failed: ${e}`);
  }

  try {
    const inputStr = JSON.stringify({ inputs: input });
    const res = execSync(`"${exePath}"`, { input: inputStr, encoding: 'utf-8' });
    const json = JSON.parse(res);
    if (json.debug) {
      json.outputs._debug = json.debug;
    }
    return json.outputs;
  } catch (e) {
    throw new Error(`CPP Execution failed: ${e}`);
  } finally {
    if (fs.existsSync(cppPath)) fs.unlinkSync(cppPath);
    if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
  }
}

// Type Inference Helper
function inferTypes(values: Record<string, any>): Record<string, DataType> {
  const types: Record<string, DataType> = {};
  for (const k in values) {
    const v = values[k];
    if (typeof v === 'number') types[k] = NUMBER_TYPE;
    else if (typeof v === 'boolean') types[k] = { kind: DataTypeKind.Primitive, name: 'boolean' };
    else if (Array.isArray(v)) {
      types[k] = { kind: DataTypeKind.Array, elementType: NUMBER_TYPE };
    } else if (typeof v === 'object' && v !== null) {
      types[k] = { kind: DataTypeKind.Any }; // Fallback
    }
  }
  return types;
}

const opts: CompilerOptions = { allowUnresolved: false };

describe('Unified Backend Verification', () => {
  beforeAll(() => {
    vi.setConfig({ testTimeout: 60000 });
  });

  testCases.forEach((tc) => {
    describe(tc.name, () => {

      const inputs = tc.inputValues || {};
      const inputTypes = tc.inputTypes || inferTypes(inputs);

      // Should pass debug flag to compiler if needed? No, compiler opts are separate.
      // But generateJS/CPP needs it.

      // JS Test
      if (!tc.skipJS) {
        it('JS Backend', () => {
          const testInputs = JSON.parse(JSON.stringify(inputs));

          const res = buildCode({
            code: tc.code,
            emitJS: true,
            emitJSRunner: true,
            outputType: tc.outputType,
            debug: tc.debug
          });

          if (res.diagnostics.length > 0) {
            // throw new Error(res.diagnostics.map(d => d.message).join('\n'));
          }
          expect(res.outJS).toBeDefined();
          expect(res.outJSRunner).toBeDefined();

          // Use the generated runner
          let ret;
          let debugOut = undefined;

          if (tc.debug) {
            const dbg = {};
            ret = res.outJSRunner!.runner(testInputs, dbg);
            debugOut = dbg;
          } else {
            ret = res.outJSRunner!.runner(testInputs);
          }

          if (tc.expected !== undefined) {
            expect(ret).toEqual(tc.expected);
          }
          if (tc.check) {
            tc.check(ret, debugOut);
          }
        });
      }

      // C++ Test
      if (!tc.skipCPP) {
        it('C++ Backend', () => {
          const testInputs = JSON.parse(JSON.stringify(inputs));

          const res = buildCode({
            code: tc.code,
            emitCPP: true,
            outputType: tc.outputType,
            debug: tc.debug
          });
          expect(res.outCPP).toBeDefined();

          const cppCode = res.outCPP!.code;
          const runRes = runCPP(cppCode, testInputs); // Helper still useful for clang execution
          if (runRes === null) return;

          let val = runRes.res;
          let debugOut = runRes._debug;

          if (tc.expected !== undefined) {
            if (typeof tc.expected === 'number') {
              expect(val).toBeCloseTo(tc.expected, 4);
            } else {
              expect(val).toEqual(tc.expected);
            }
          }
          if (tc.check) {
            tc.check(val, debugOut);
          }
        });
      }

      // WGSL Test
      if (!tc.skipWGSL) {
        it('WGSL Backend (Compile Only)', () => {
          const res = buildCode({
            code: tc.code,
            emitWGSL: true,
            outputType: tc.outputType
          });
          expect(res.outWGSL).toBeDefined();
          expect(res.outWGSL!.code).toContain('fn main');
        });
      }

    });
  });
});
