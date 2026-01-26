import { DataType, DataTypeKind, PrimitiveType } from './ir-types';

export interface TestCase {
  name: string;
  code: string;
  inputValues?: Record<string, any>;
  inputTypes?: Record<string, DataType>; // Optional: if not provided, inferred from values
  outputType?: DataType; // Optional: inferred from expected if simple, else required for C++
  expected?: any;
  check?: (res: any, debug?: any) => void;
  // Metadata to skip specific backends if feature missing
  skipCPP?: boolean;
  skipJS?: boolean;
  skipWGSL?: boolean; // New
  debug?: boolean;
}

const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };
const BOOL_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'boolean' };

export const testCases: TestCase[] = [
  // --- Basics ---
  {
    name: 'Basic Math (Return 42)',
    code: 'return 40 + 2;',
    expected: 42
  },
  {
    name: 'Logic Ops (&& ||)',
    code: 'return (true && false) || true;',
    code: 'return (true && false) || true;',
    check: (res: any) => {
      if (typeof res === 'boolean' && res === true) return;
      if (typeof res === 'number' && Math.abs(res - 1) < 0.001) return;
      throw new Error(`Expected true or 1, got ${res}`);
    }
  },
  {
    name: 'Unary Ops (- !)',
    code: 'return -42;',
    expected: -42
  },
  {
    name: 'Unary Ops (- !)',
    code: 'return -42;',
    expected: -42
  },
  {
    name: 'Mixed Logic Ops',
    code: 'return (true && false) || true || 1.0;',
    expected: 1 // JS returns true (1), or 1.0? true || 1.0 is true.
    // In our system, return boolean is typically 1 (if number expected) or true.
    // If output is number, correct is 1.
  },
  {
    name: 'Variables (Input)',
    code: 'return x * 2;',
    inputValues: { x: 21 },
    expected: 42
  },
  {
    name: 'If Statement (Branching)',
    code: `
      if (x > 10) {
        return 1;
      } else {
        return 0;
      }
    `,
    inputValues: { x: 11 },
    expected: 1
  },
  {
    name: 'Loops (While)',
    code: `
       let i = 0;
       while (i < 5) {
         i = i + 1;
       }
       return i;
    `,
    expected: 5
  },

  // --- Arrays ---
  {
    name: 'Array Push & Access',
    code: `
        let arr = [1, 2, 3];
        arr.push(4);
        return arr[3];
    `,
    outputType: NUMBER_TYPE, // Explicit return type needed for C++? Inferred from code? C++ needs explicit output type in generateCPP.
    // If not provided here, harness must infer "number" from expected "4".
    expected: 4,
    skipWGSL: true // Dynamic array push not supported
  },
  {
    name: 'Array Convolution (Loops + Access)',
    code: `
       const kernel = [0.5, 1];
       const result: number[] = [];
       // signal is input array of size 5
       for (let i = 0; i < 4; i++) {
          let sum = 0;
          for (let j = 0; j < 2; j++) {
             sum = sum + signal[i+j] * kernel[j];
          }
          result.push(sum);
       }
       return result;
    `,
    inputValues: { signal: [1, 2, 3, 4, 5] },
    inputTypes: { signal: { kind: DataTypeKind.Array, elementType: NUMBER_TYPE } },
    outputType: { kind: DataTypeKind.Array, elementType: NUMBER_TYPE },
    expected: [2.5, 4.0, 5.5, 7.0],
    skipWGSL: true // Dynamic array push not supported
  },

  // --- Structs & Reference Semantics ---
  {
    name: 'Struct Literal & Access',
    code: `
        const s = { x: 10, y: 20 };
        return s.x + s.y;
    `,
    expected: 30
  },
  {
    name: 'Reference Sharing (Mutable Alias)',
    code: `
        let p1 = { x: 1, y: 1 };
        let p2 = p1; // Alias (Ref)
        p2.x = 10;
        return p1.x; // Becomes 10
    `,
    expected: 10,
    skipWGSL: true // Reference semantics lost (Copy)
  },
  {
    name: 'Nested Struct Mutation',
    code: `
         let a = { p: { x: 1 } };
         let b = a;
         b.p.x = 10;
         return a.p.x;
    `,
    expected: 10,
    skipWGSL: true // Reference semantics lost (Copy)
  },
  {
    name: 'Array Reference Sharing',
    code: `
        let a = [1, 2];
        let b = a;
        b[0] = 10;
        return a[0];
    `,
    expected: 10,
    skipWGSL: true // Reference semantics lost (Copy)
  },
  {
    name: 'Struct Reference Assignment (Alias)',
    code: `
        // interface S { x: number; }
        let s = { x: 0 };
        let r = s; // Alias r -> s
        r.x = 10;
        return s.x; // Should be 10 if aliased
    `,
    expected: 10,
    skipWGSL: true // Reference semantics lost (Copy)
  },
  {
    name: 'Nested Array Element Alias',
    code: `
        // interface Vec2 { x: number; y: number; }
        // Mutable array of structs
        let arr = [{x:0, y:0}, {x:10, y:10}];

        for (let i = 0; i < 2; i++) {
            let v = arr[i]; // Alias v -> arr[i] (Reference)
            // If v is a copy, this won't affect arr.
            // If v is reference, it will.
            v.x = v.x + 100;
        }
        return arr[0].x; // Should be 100
    `,
    expected: 100,
    skipWGSL: true // Reference semantics lost (Copy)
  },
  {
    name: 'Reference Passing to Function',
    code: `
        // interface S { x: number; }
        function modify(p: { x: number }) {
            p.x = p.x + 20;
        }

        let s = { x: 10 };
        modify(s); // Should pass 's' by reference (inline or ptr)
        return s.x;
    `,
    expected: 30,
    skipWGSL: true // Reference semantics lost (Copy)
  },

  // --- Math Intrinsics ---
  {
    name: 'Math Intrinsics (min/pow)',
    code: `
         let val = 2;
         val = Math.pow(val, 3); // 8
         return Math.min(val, 5); // 5
    `,
    expected: 5
  },

  // --- Optional / Union Types (Advanced) ---
  {
    name: 'Optional Input Field',
    code: `return input.y;`,
    inputValues: { input: { x: 1, y: 100 } },
    inputTypes: {
      input: {
        kind: DataTypeKind.Struct,
        name: 'InputStruct',
        fields: {
          x: NUMBER_TYPE,
          fields: { x: NUMBER_TYPE, y: { kind: DataTypeKind.Union, types: [NUMBER_TYPE, { kind: DataTypeKind.Primitive, name: 'undefined' }] } }
        }
      } as any // Simplified manual type const
    },
    // Actually constructing complex types inline is messy. C++ test had logic for this.
    // Let's defer complex custom Struct types to a check if needed, or define proper Types.
    check: (res: any) => {
      // expect(res).toBe(100);
    },
    skipCPP: true, // Need to fix InputStruct definition in harness to match C++ requirements perfectly?
    skipJS: false,
    skipWGSL: true // Union Types not supported
  }
];

// Fixups for complex types in test data
const INPUT_STRUCT_TYPE: DataType = {
  kind: DataTypeKind.Struct,
  name: 'InputStruct',
  fields: {
    x: NUMBER_TYPE,
    y: { kind: DataTypeKind.Union, types: [NUMBER_TYPE, { kind: DataTypeKind.Primitive, name: 'undefined' }] }
  }
};

// Re-define the last case correctly
testCases[testCases.length - 1] = {
  name: 'Optional Input Field (Present)',
  code: 'return input.y;',
  inputValues: { input: { x: 1, y: 100 } },
  inputTypes: { input: INPUT_STRUCT_TYPE },
  outputType: { kind: DataTypeKind.Union, types: [NUMBER_TYPE, { kind: DataTypeKind.Primitive, name: 'undefined' }] }, // Output is optional
  // Note: C++ returns 0 or value? Or std::optional?
  // C++ backend test expected 100 or null.
  expected: 100,
  skipCPP: false,
  skipWGSL: true // Union Types not supported
};

testCases.push({
  name: 'Optional Input Field (Missing)',
  code: 'return input.y;',
  inputValues: { input: { x: 1 } },
  inputTypes: { input: INPUT_STRUCT_TYPE },
  outputType: { kind: DataTypeKind.Union, types: [NUMBER_TYPE, { kind: DataTypeKind.Primitive, name: 'undefined' }] },
  check: (res: any) => {
    // JS returns undefined, C++ returns null (JSON)
    if (res !== null && res !== undefined) throw new Error(`Expected null/undefined, got ${res}`);
  },
  skipCPP: false,
  skipWGSL: true // Union Types not supported
});

testCases.push({
  name: 'Dynamic Function Dispatch (Inlining)',
  code: `
      const add = (a: number) => a + 10;
      const mul = (a: number) => a * 10;
      // input.mode is struct field
      let f = add;
      if (input.mode > 0) {
          f = mul;
      }
      return f(5);
    `,
  inputValues: { input: { mode: 1 } },
  inputTypes: { input: { kind: DataTypeKind.Struct, fields: { mode: NUMBER_TYPE } } as DataType },
  expected: 50,
  skipWGSL: true // Functional dispatch/inlining issues
});

testCases.push({
  name: 'Debug Logging',
  code: `
        let y = x * 2;
        y = y + 1;
        return y;
    `,
  inputValues: { x: 10 },
  debug: true,
  expected: 21,
  check: (res: any, debug: any) => {
    // expect debug to contain entries
    if (!debug) throw new Error("Debug log missing");
    const keys = Object.keys(debug || {});
    if (keys.length === 0) throw new Error("Debug log empty");
    // Check for specific lines values if possible?
    // JS keys are line numbers (string).
  },
  skipWGSL: true // record_debug intrinsic not available
});

// --- Simulations ---

const BALL_TYPE: DataType = {
  kind: DataTypeKind.Struct,
  name: 'Ball',
  fields: {
    x: NUMBER_TYPE, y: NUMBER_TYPE,
    vx: NUMBER_TYPE, vy: NUMBER_TYPE
  }
};

const BALLS_INPUT_TYPE: DataType = { kind: DataTypeKind.Array, elementType: BALL_TYPE };

testCases.push({
  name: 'Bouncing Balls Simulation (1 Tick)',
  code: `
        const width = 100.0;
        const result = balls; // Modify in place (reference) or copy?
        // In JS/C++ backend, 'balls' is a reference to the array.
        // But we iterate and modify objects inside it.

        for (let i = 0; i < balls.length; i++) {
           let b = balls[i];

           // Physics Update
           b.x = b.x + b.vx * dt;
           b.y = b.y + b.vy * dt;

           // Bounce X
           if (b.x > width) {
              b.x = width;
              b.vx = -b.vx;
           } else if (b.x < 0) {
              b.x = 0;
              b.vx = -b.vx;
           }

           // Bounce Y (Floor at 0 for simplicity or ceiling?)
           if (b.y < 0) {
              b.y = 0;
              b.vy = -b.vy;
           }
        }
        return balls;
  `,
  inputValues: {
    dt: 0.1,
    balls: [
      { x: 10, y: 10, vx: 50, vy: 0 },
      { x: 99, y: 10, vx: 50, vy: 0 }
    ]
  },
  inputTypes: {
    dt: NUMBER_TYPE,
    balls: BALLS_INPUT_TYPE
  },
  outputType: BALLS_INPUT_TYPE,
  debug: true,
  check: (res: any, debug: any) => {
    // Expect array of 2 balls
    if (!Array.isArray(res) || res.length !== 2) throw new Error("Expected 2 balls");

    const b0 = res[0];
    const b1 = res[1];

    // b0: 10 + 50*0.1 = 15
    if (Math.abs(b0.x - 15) > 0.1) throw new Error(`b0.x expected ~15, got ${b0.x}. Debug: ${JSON.stringify(debug)}`);

    // b1: 99 + 5 = 104 -> Clamped to 100. vx flipped to -50.
    if (Math.abs(b1.x - 100) > 0.1) throw new Error(`b1.x expected ~100, got ${b1.x}`);
    if (Math.abs(b1.vx - -50) > 0.1) throw new Error(`b1.vx expected -50, got ${b1.vx}`);
  }
});
// Need to skipWGSL for balls because of Reference Mutation in loop?
// Actually 'b.x = ...' where b = balls[i].
// Ref Safety should catch this?
// Yes, likely WGSL will copy.
testCases[testCases.length - 1].skipWGSL = true;

// --- Stress Tests ---

testCases.push({
  name: 'Matrix Multiplication (2x2)',
  code: `
      const A = [[1, 2], [3, 4]];
    const B = [[5, 6], [7, 8]];
    // Result C = A * B
    // C[0][0] = 1*5 + 2*7 = 5 + 14 = 19
    // C[0][1] = 1*6 + 2*8 = 6 + 16 = 22
    // C[1][0] = 3*5 + 4*7 = 15 + 28 = 43
    // C[1][1] = 3*6 + 4*8 = 18 + 32 = 50

    let result: number[] = [];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        let sum = 0;
        for (let k = 0; k < 2; k++) {
          sum = sum + A[i][k] * B[k][j];
        }
        result.push(sum);
      }
    }
    return result;
    `,
  outputType: { kind: DataTypeKind.Array, elementType: NUMBER_TYPE },
  expected: [19, 22, 43, 50],
  skipWGSL: true // Dynamic array push
});

testCases.push({
  name: 'Chained Generics (Structural)',
  code: `
    function identity<T>(arg: T): T {
      return arg;
    }

    function box<U>(val: U) {
      return { contents: identity(val) };
    }

    function process<X>(item: X) {
      return box(item);
    }

    return process([1, 2]);
    `,
  // Output: { contents: [1, 2] }
  // Struct definition for output?
  // Inferring generic return type in C++ test harness is hard without explicit outputType.
  // The output is Box<Array<number>>.
  // We need to construct the DataType manually for C++ codegen to know what to wrap the result in?
  // actually verify_cpp_runner logic handles some inference or we need explicit.
  // CodeGen needs outputType to generate the 'result' var declaration in C++.
  // Let's define it.
  outputType: {
    kind: DataTypeKind.Struct,
    fields: {
      contents: { kind: DataTypeKind.Array, elementType: NUMBER_TYPE }
    }
  },
  expected: { contents: [1, 2] },
  skipCPP: true,
  skipWGSL: true
});

// --- Ray Tracer ---

const VEC3_TYPE: DataType = {
  kind: DataTypeKind.Struct,
  name: 'Vec3',
  fields: { x: NUMBER_TYPE, y: NUMBER_TYPE, z: NUMBER_TYPE }
};

const RT_INPUT_TYPE: DataType = {
  kind: DataTypeKind.Struct,
  name: 'RtInput',
  fields: { u: NUMBER_TYPE, v: NUMBER_TYPE }
};

testCases.push({
  name: 'Ray Tracer (Sphere Diffuse)',
  code: `
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
        const intersectSphere = (ray: { origin: Vec3, dir: Vec3 }, sph: { center: Vec3, radius: number }) => {
            const oc = sub(ray.origin, sph.center);
            const a = dot(ray.dir, ray.dir);
            const b = 2.0 * dot(oc, ray.dir);
            const c = dot(oc, oc) - sph.radius * sph.radius;
            const discriminant = b*b - 4*a*c;

            if (discriminant < 0) return -1.0;
            return (-b - Math.sqrt(discriminant)) / (2.0*a);
        };

        // --- Rendering ---
        // Input: input.u, input.v

        // Camera setup
        const origin = { x: 0, y: 0, z: 0 };
        const lowerLeft = { x: -2, y: -1, z: -1 };
        const horizontal = { x: 4, y: 0, z: 0 };
        const vertical = { x: 0, y: 2, z: 0 };

        const ray_target = add(lowerLeft, add(mul(horizontal, input.u), mul(vertical, input.v)));
        const direction = normalize(sub(ray_target, origin));
        const ray = { origin: origin, dir: direction };

        // Trace
        const t = intersectSphere(ray, sphere);

        if (t > 0) {
            // Hit!
            // Calculate normal
            const hitPos = add(ray.origin, mul(ray.dir, t));
            const normal = normalize(sub(hitPos, sphere.center));

            // Diffuse shading
            let diff = Math.max(dot(normal, lightDir), 0);

            // Ambient
            diff = diff + 0.1;

            return mul(sphere.color, diff);
        }

        // Sky color (Gradient)
        const t2 = 0.5 * (direction.y + 1.0);
        // (1-t)*white + t*blue
        const white: Vec3 = {x:1, y:1, z:1};
        const blue: Vec3 = {x:0.5, y:0.7, z:1.0};
        return add(mul(white, 1.0-t2), mul(blue, t2));
    `,
  inputValues: { input: { u: 0.5, v: 0.5 } },
  inputTypes: { input: RT_INPUT_TYPE },
  outputType: VEC3_TYPE,
  check: (res: any) => {
    // Center hit -> Reddish
    if (res.x < 0.1) throw new Error(`Expected red component > 0.1 for center hit, got ${JSON.stringify(res)}`);
  },
  skipCPP: true
});

testCases.push({
  name: 'Ray Tracer (Sky Background)',
  code: testCases[testCases.length - 1].code, // Reuse code
  inputValues: { input: { u: 0, v: 0 } },
  inputTypes: { input: RT_INPUT_TYPE },
  outputType: VEC3_TYPE,
  check: (res: any) => {
    // Corner -> Blueish Sky
    if (res.z < 0.5) throw new Error(`Expected blue component > 0.5 for sky hit, got ${JSON.stringify(res)}`);
  },
  skipCPP: true
});

// --- Callbacks & Lambdas ---

testCases.push({
  name: 'Mixed Struct Callbacks (Compile & Run)',
  code: `
        // Helper function expecting a dictionary of callbacks and values
        function process(opts: { onStart: () => number, val: number }) {
        const x = opts.onStart(); // Call lambda
        return x + opts.val;      // Use dynamic val
      }

        // Usage
        const cb = () => 42;
    // Mixed struct: 'onStart' is Const (Lambda), 'val' is Dynamic (Input)
    // dynamic_input global/input
    const result = process({ onStart: cb, val: dynamic_input });
    return result;
    `,
  inputValues: { dynamic_input: 10 },
  expected: 52,
  skipWGSL: true // Lambda struct fields
});

testCases.push({
  name: 'Inline Object Literal Arguments',
  code: `
    function run(ops: { f: (x: number) => number }) {
      return ops.f(10);
    }
    const res = run({ f: (x) => x * 2 });
    return res;
    `,
  expected: 20,
  skipCPP: true,
  skipWGSL: true
});

// --- Mutation & Inlining ---

testCases.push({
  name: 'Array Mutation',
  code: `
        let arr = [1, 2, 3];
        arr[0] = 10;
        return arr[0];
    `,
  expected: 10,
  skipWGSL: false // Mutation of array ref
});

testCases.push({
  name: 'Struct Mutation',
  code: `
        let p = { x: 1, y: 2 };
        p.x = 100;
        return p.x + p.y;
    `,
  expected: 102,
  skipWGSL: false // Mutation of struct ref
});

testCases.push({
  name: 'Nested Properties Mutation',
  code: `
        let arr = [{ x: 1 }, { x: 2 }];
        arr[0].x = 50;
        return arr[0].x + arr[1].x;
    `,
  expected: 52,
  skipWGSL: false // Mutation of nested ref
});

testCases.push({
  name: 'Compound Assignment',
  code: `
          let p = { val: 10 };
          p.val += 5;
          return p.val;
      `,
  expected: 15,
  skipWGSL: false // Compound assign to ref
});

testCases.push({
  name: 'Helper Function Inlining',
  code: `
          function add(a, b) { return a + b; }
          return add(10, 20);
      `,
  expected: 30,
  skipWGSL: true // Helper function emission issues
});

// --- Stress Tests ---

testCases.push({
  name: 'Mandelbrot Iteration (Structs, Loops, Break)',
  code: `
        interface Complex { r: number; i: number; }

        let c = { r: cx, i: cy };
        let z = { r: 0.0, i: 0.0 };
        let iter = 0;

        while (iter < maxIter) {
            let r2 = z.r * z.r;
            let i2 = z.i * z.i;

            if (r2 + i2 > 4.0) {
                break;
            }

            let next_r = r2 - i2 + c.r;
            let next_i = 2.0 * z.r * z.i + c.i;

            // Assign new struct
            z = { r: next_r, i: next_i };
            iter++;
        }

        return iter;
    `,
  inputValues: { cx: 0, cy: 0, maxIter: 100 },
  expected: 100
});

testCases.push({
  name: 'Mandelbrot Divergence',
  code: testCases[testCases.length - 1].code,
  inputValues: { cx: 2, cy: 2, maxIter: 100 },
  expected: 1
});
