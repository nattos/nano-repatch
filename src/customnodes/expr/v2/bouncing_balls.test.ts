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
  const filename = `sim_test_${Date.now()}_${Math.floor(Math.random() * 1000)}.cpp`;
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
    return json.outputs;
  } catch (e) {
    throw new Error(`Execution failed: ${e}`);
  }
}

function compileBallSim(src: string): string {
  // Input: balls array, dt
  // balls element type: Struct { x, y, vx, vy }
  const ballType = {
    kind: DataTypeKind.Struct,
    fields: {
      x: NUMBER_TYPE, y: NUMBER_TYPE,
      vx: NUMBER_TYPE, vy: NUMBER_TYPE
    }
  };
  const inputs = {
    balls: { kind: DataTypeKind.Array, elementType: ballType },
    dt: NUMBER_TYPE
  };

  const ir = compileToIR(src, inputs as any);
  return generateCPP(ir, { inputs: inputs as any });
}

describe('Bouncing Balls Simulation', () => {

  it('should update positions and handle collisions', () => {
    const src = `
        const width = 100.0;
        const height = 100.0;

        for (let i = 0; i < balls.length; i++) {
           let b = balls[i];
           // Update Position
           b.x += b.vx * dt;
           b.y += b.vy * dt;

           // Bounce X
           if (b.x < 0) {
              b.x = 0;
              b.vx = -b.vx;
           } else if (b.x > width) {
              b.x = width; // Clamp
              b.vx = -b.vx;
           }

           // Bounce Y (Simple check)
           if (b.y < 0) {
              b.y = 0;
              b.vy = -b.vy;
           }

           // Write back (Necessary? b is reference? No, b is local copy unless compiled as reference)
           // If 'b' is a Struct, assignments to 'b.x' modify local 'b'.
           // Need to write back to array?
           // balls[i] = b;
        }
        return balls;
    `;
    // NOTE: In JS `let b = balls[i]` copies the object reference, so `b.x += ...` modifies the array.
    // In C++ (generated), `b` might be a copy (value semantics for structs).
    // If our compiler emits `auto b = balls[i]`, it is a COPY.
    // To support reference semantics, we need `let b` to be `&b` (unsupported yet?)
    // OR simply `balls[i].x += ...` directly.
    // Let's rewrite simulation to use direct array access for now, OR write-back.
    // "b.x += ..."

    const directSrc = `
        const width = 100.0;

        for (let i = 0; i < balls.length; i++) {
           // Direct Access Mutation
           balls[i].x += balls[i].vx * dt;
           balls[i].y += balls[i].vy * dt;

           if (balls[i].x < 0.0) {
               balls[i].x = 0.0;
               balls[i].vx = -balls[i].vx;
           }
           if (balls[i].x > width) {
               balls[i].x = width;
               balls[i].vx = -balls[i].vx;
           }
        }
        return balls;
    `;

    const inputs = {
      dt: 0.1,
      balls: [
        { x: 10, y: 10, vx: 50, vy: 0 }, // Normal move
        { x: 99, y: 10, vx: 50, vy: 0 }, // Out of bounds soon
      ]
    };

    const cpp = compileBallSim(directSrc);
    // console.error("CPP_CODE:\n" + cpp);
    const res = runCPP(cpp, inputs);

    // Check Result
    const balls = (res as any).res;
    if (!balls) throw new Error("Output 'res' not found in: " + JSON.stringify(res));

    const b0 = balls[0];
    const b1 = balls[1];

    // b0: 10 + 50*0.1 = 15.
    console.error(`Simulation Result: b0.x=${b0.x}, b1.x=${b1.x}, b1.vx=${b1.vx}`);
    expect(b0.x).toBeCloseTo(15, 1);

    // b1: 99 + 5 = 104. > 100.
    // Should be clamped to 100 and vx inverted.
    expect(b1.x).toBeCloseTo(100);
    expect(b1.vx).toBeCloseTo(-50);
  }, 30000);
});
