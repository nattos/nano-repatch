import { describe, it, expect, vi, beforeAll } from 'vitest';
import { compileToIR } from './compiler';
import { generateCPP } from './codegen-cpp';
import { DataTypeKind, PrimitiveType } from './ir-types';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };

// Helpers to run C++ (Copied from cpp-integration.test.ts)
const TMP_DIR = path.resolve(__dirname, '../../../../tmp');

function runCPP(code: string, input: any): any {
  const id = Math.random().toString(36).substring(7);
  const filename = `rt_test_${Date.now()}_${id}.cpp`;
  const cppPath = path.join(TMP_DIR, filename);
  const exePath = path.join(TMP_DIR, filename.replace('.cpp', '.out'));

  if (!fs.existsSync(path.join(TMP_DIR, 'json.hpp'))) {
    throw new Error("json.hpp not found in tmp/");
  }

  try {
    fs.writeFileSync(cppPath, code);
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
  } finally {
    if (fs.existsSync(cppPath)) fs.unlinkSync(cppPath);
    if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
  }
}

describe('Ray Tracer Stress Test', () => {
  beforeAll(() => {
    vi.setConfig({ testTimeout: 60000 });
  });

  it('should render a sphere with diffuse lighting', () => {
    const src = `
        // --- Structs ---
        interface Vec3 {
            x: number;
            y: number;
            z: number;
        }

        interface Sphere {
            center: Vec3;
            radius: number;
            color: Vec3; // RGB
        }

        interface Ray {
            origin: Vec3;
            dir: Vec3;
        }

        // --- Helpers ---
        // Basic Math
        const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

        const sub = (a: Vec3, b: Vec3) : Vec3 => {
            return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
        };

        const add = (a: Vec3, b: Vec3) : Vec3 => {
            return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
        };

        const mul = (a: Vec3, s: number) : Vec3 => {
            return { x: a.x * s, y: a.y * s, z: a.z * s };
        };

        const length = (v: Vec3) => Math.sqrt(dot(v, v));

        const normalize = (v: Vec3) : Vec3 => {
            const l = length(v);
            return { x: v.x / l, y: v.y / l, z: v.z / l };
        };

        // --- Scene ---
        const sphere = {
            center: { x: 0, y: 0, z: -5 },
            radius: 1,
            color: { x: 1, y: 0, z: 0 } // Red
        };

        // Light direction (approx directional light)
        const lightDir = normalize({ x: 1, y: 1, z: 1 });

        // --- Intersection ---
        const intersectSphere = (ray: Ray, sph: Sphere) => {
            const oc = sub(ray.origin, sph.center);
            const a = dot(ray.dir, ray.dir);
            const b = 2.0 * dot(oc, ray.dir);
            const c = dot(oc, oc) - sph.radius * sph.radius;
            const discriminant = b*b - 4*a*c;

            if (discriminant < 0) return -1.0;
            return (-b - Math.sqrt(discriminant)) / (2.0*a);
        };

        // --- Rendering ---
        // Input: Pixel coordinate (uv)
        // We calculate output color for this pixel
        // Input from C++ harness: { u: number, v: number }

        // Camera setup
        const origin = { x: 0, y: 0, z: 0 };
        const lowerLeft = { x: -2, y: -1, z: -1 };
        const horizontal = { x: 4, y: 0, z: 0 };
        const vertical = { x: 0, y: 2, z: 0 };

        const target = add(lowerLeft, add(mul(horizontal, input.u), mul(vertical, input.v)));
        const direction = normalize(sub(target, origin));
        const ray = { origin: origin, dir: direction };

        // Trace
        const t = intersectSphere(ray, sphere);

        if (t > 0) {
            // Hit!
            // Calculate normal
            const hitPos = add(ray.origin, mul(ray.dir, t));
            const normal = normalize(sub(hitPos, sphere.center));

            // Diffuse shading
            let diff = dot(normal, lightDir);
            if (diff < 0) diff = 0;

            // Ambient
            diff = diff + 0.1;

            return mul(sphere.color, diff);
        }

        // Sky color (Gradient)
        const t2 = 0.5 * (direction.y + 1.0);
        // (1-t)*white + t*blue
        return add(mul({x:1, y:1, z:1}, 1.0-t2), mul({x:0.5, y:0.7, z:1.0}, t2));
    `;

    // Input Type
    const INPUT_TYPE = {
      kind: DataTypeKind.Struct,
      fields: { u: NUMBER_TYPE, v: NUMBER_TYPE }
    };

    // Output Type (Vec3)
    const VEC3_TYPE = {
      kind: DataTypeKind.Struct,
      fields: { x: NUMBER_TYPE, y: NUMBER_TYPE, z: NUMBER_TYPE }
    };

    // Compile
    const ir = compileToIR(src, { input: INPUT_TYPE as any });
    const cpp = generateCPP(ir, {
      inputs: { input: INPUT_TYPE as any },
      outputType: VEC3_TYPE as any
    });

    // Test: Center of screen (0.5, 0.5) -> Should hit sphere?
    // Sphere at z=-5. Radius 1.
    // Center ray (0,0,0) -> (0,0,-1).
    // Passes through (0,0,-1)... hits (0,0,-4).
    // So u=0.5, v=0.5 should hit.
    const res = runCPP(cpp, { input: { u: 0.5, v: 0.5 } });

    expect(res.res.x).toBeGreaterThan(0.1); // Should be reddish

    // Test: Corner (0,0) -> Sky
    const resSky = runCPP(cpp, { input: { u: 0, v: 0 } });
    expect(resSky.res.z).toBeGreaterThan(0.5); // Blueish logic
  }, 60000);
});
