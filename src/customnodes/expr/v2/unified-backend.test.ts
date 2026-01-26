import { describe, it, expect, vi, beforeAll } from 'vitest';
import { compileToIR, CompilerOptions } from './compiler';
import { generateJS } from './codegen-js';
import { generateCPP } from './codegen-cpp';
import { generateWGSL } from './codegen-wgsl'; // New
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
          const testInputs = JSON.parse(JSON.stringify(inputs)); // Deep copy to prevent mutation
          const jsIR = compileToIR(tc.code, inputTypes);
          const js = generateJS(jsIR, { inputs: inputTypes, debug: tc.debug });

          let res = runJS(js, testInputs, tc.debug);
          let debugOut = undefined;
          if (tc.debug) {
            debugOut = res._debug;
            res = res.res;
          }

          if (tc.expected !== undefined) {
            expect(res).toEqual(tc.expected);
          }
          if (tc.check) {
            tc.check(res, debugOut);
          }
        });
      }

      // C++ Test
      if (!tc.skipCPP) {
        it('C++ Backend', () => {
          const testInputs = JSON.parse(JSON.stringify(inputs)); // Deep copy
          const cppIR = compileToIR(tc.code, inputTypes);
          let outType = tc.outputType;
          if (!outType && tc.expected !== undefined) {
            if (typeof tc.expected === 'number') outType = NUMBER_TYPE;
            else if (typeof tc.expected === 'boolean') outType = { kind: DataTypeKind.Primitive, name: 'boolean' };
          }
          if (!outType) outType = NUMBER_TYPE;

          const cpp = generateCPP(cppIR, { inputs: inputTypes, outputType: outType, debug: tc.debug });

          const res = runCPP(cpp, testInputs);
          if (res === null) return;

          let val = res.res;
          let debugOut = res._debug;

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

      // WGSL Test (Generation Only)
      if (!tc.skipWGSL) {
        it('WGSL Backend (Compile Only)', () => {
          const testInputs = JSON.parse(JSON.stringify(inputs));
          const wgslIR = compileToIR(tc.code, inputTypes);
          let outType = tc.outputType;
          if (!outType && tc.expected !== undefined) {
            if (typeof tc.expected === 'number') outType = NUMBER_TYPE;
            else if (typeof tc.expected === 'boolean') outType = { kind: DataTypeKind.Primitive, name: 'boolean' };
          }
          if (!outType) outType = NUMBER_TYPE;

          // Simply generate and assert non-empty
          const wgsl = generateWGSL(wgslIR, { inputs: inputTypes, outputType: outType });
          expect(wgsl.length).toBeGreaterThan(0);
          expect(wgsl).toContain('fn main()');
        });
      }

    });
  });
});
