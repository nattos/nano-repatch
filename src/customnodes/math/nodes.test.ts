
import { random } from "./nodes";
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext } from "../../structor/structor";
import { defaultNodeRepository } from "../../structor/repository";

// Mock ExecutionContext with working broadcast
const createMockContext = (): ExecutionContext => ({
  broadcast: (config: any, inputs: any) => ({
    apply: (fn: Function) => fn(inputs) // Direct pass-through
  }) as any,
  repository: defaultNodeRepository,
  clock: { beat: 0, dt: 0.1 },
  nodeState: new Map(),
  audio: { context: {} as AudioContext }
});

describe("math.random", () => {
  let context: ExecutionContext;

  beforeEach(() => {
    context = createMockContext();
  });

  it("should generate deterministic values based on seed", () => {
    (context as any).nodeId = "random-1";
    // Default seed 12345
    const config1 = { fields: { seed: 12345 } };

    // Initial execute (pre-warm check? No, state init happens in createState)
    // We need to trigger it to get a NEW value, but it has an initial value.

    // Check initial value
    let state1 = random.createState!(config1, context);
    const exec1: any = random.execute({ trigger: [] } as any, config1, context, state1);
    const val1 = exec1.fields?.value ?? exec1.value;

    (context as any).nodeId = "random-2";
    const config2 = { fields: { seed: 12345 } };
    let state2 = random.createState!(config2, context);
    const exec2: any = random.execute({ trigger: [] } as any, config2, context, state2);
    const val2 = exec2.fields?.value ?? exec2.value;

    expect(val1).toBeDefined();
    expect(val1).toBe(val2);

    // Different seed
    (context as any).nodeId = "random-3";
    const config3 = { fields: { seed: 67890 } };
    let state3 = random.createState!(config3, context);
    const exec3: any = random.execute({ trigger: [] } as any, config3, context, state3);
    const val3 = exec3.fields?.value ?? exec3.value;

    expect(val3).not.toBe(val1);
  });

  it("should only generate new value on Note On trigger in on-trigger mode", () => {
    (context as any).nodeId = "random-trig";
    const config = { mode: 'on-trigger', seed: 12345 } as any; // Compiled config structure
    const state = random.createState!(config, context);

    // Frame 1: Empty Stream. No change.
    let result: any = random.execute({ trigger: [] } as any, config, context, state);
    const initialVal = result.fields?.value ?? result.value;

    // Frame 2: Note Off. No change.
    result = random.execute({ trigger: [{ type: 'note_off', velocity: 0 }] } as any, config, context, state);
    expect(result.fields?.value ?? result.value).toBe(initialVal);

    // Frame 3: Note On. CHANGE.
    result = random.execute({ trigger: [{ type: 'note_on', velocity: 100 }] } as any, config, context, state);
    const newVal = result.fields?.value ?? result.value;
    expect(newVal).not.toBe(initialVal);

    // Frame 4: Empty Stream. No change.
    result = random.execute({ trigger: [] } as any, config, context, state);
    expect(result.fields?.value ?? result.value).toBe(newVal);

    // Frame 5: Note On 0 Velocity (Note Off). No change.
    result = random.execute({ trigger: [{ type: 'note_on', velocity: 0 }] } as any, config, context, state);
    expect(result.fields?.value ?? result.value).toBe(newVal);

    // Frame 6: Multiple triggers? Should advance generator twice, but output ONE value (the last one).
    const v2 = state.currentValue;

    result = random.execute({
      trigger: [
        { type: 'note_on', velocity: 100 },
        { type: 'note_on', velocity: 100 }
      ]
    } as any, config, context, state);

    const v4 = result.fields?.value ?? result.value;
    expect(v4).not.toBe(v2);
  });

  it("should generate new value every frame in free-run mode", () => {
    (context as any).nodeId = "random-freerun";
    const config = { mode: 'free-run', seed: 12345 } as any;
    const state = random.createState!(config, context);

    // It should be realtime
    expect(random.isRealtime!(config)).toBe(true);

    const result1: any = random.execute({ trigger: [] } as any, config, context, state);
    const val1 = result1.fields?.value ?? result1.value;

    const result2: any = random.execute({ trigger: [] } as any, config, context, state);
    const val2 = result2.fields?.value ?? result2.value;

    // Should be different
    expect(val1).not.toBe(val2);

    const result3: any = random.execute({ trigger: [] } as any, config, context, state);
    const val3 = result3.fields?.value ?? result3.value;

    expect(val3).not.toBe(val2);
    expect(val3).not.toBe(val1);
  });

  it("should produce deterministic sequence in free-run mode", () => {
    (context as any).nodeId = "random-freerun-1";
    const config1 = { mode: 'free-run', seed: 999 } as any;
    let state1 = random.createState!(config1, context);
    const val1_1 = (random.execute({} as any, config1, context, state1) as any).fields?.value ?? (random.execute({} as any, config1, context, state1) as any).value;
    const val1_2 = (random.execute({} as any, config1, context, state1) as any).fields?.value ?? (random.execute({} as any, config1, context, state1) as any).value;

    (context as any).nodeId = "random-freerun-2";
    const config2 = { mode: 'free-run', seed: 999 } as any;
    let state2 = random.createState!(config2, context);
    const val2_1 = (random.execute({} as any, config2, context, state2) as any).fields?.value ?? (random.execute({} as any, config2, context, state2) as any).value;
    const val2_2 = (random.execute({} as any, config2, context, state2) as any).fields?.value ?? (random.execute({} as any, config2, context, state2) as any).value;

    expect(val1_1).toBe(val2_1);
    expect(val1_2).toBe(val2_2);
  });

});
