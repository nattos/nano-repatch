
import { sawtooth } from "./nodes";
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext } from "../../structor/structor";
import { defaultNodeRepository } from "../../structor/repository";

// Mock ExecutionContext
const createMockContext = (): ExecutionContext => ({
    broadcast: vi.fn(),
    repository: defaultNodeRepository,
    clock: { beat: 0, dt: 0.1 },
    nodeState: new Map(),
    audio: { context: {} as AudioContext }
});

describe("gen.sawtooth", () => {
    let context: ExecutionContext;

    beforeEach(() => {
        context = createMockContext();
        // Default dt = 0.1s for easy math
        context.clock.dt = 0.1;
    });

    it("should execute with default config", () => {
        const config = { fields: {}, };
        // We need to set context.nodeId or use the implicit key.
        // Let's set a nodeId.
        (context as any).nodeId = "test-node";

        // Initial execution
        // Simulate Executor providing default value 1.0
        let result = sawtooth.execute({ fields: { freq: 1.0 }, }, config, context);
        // Phase starts at 0. First execution:
        // definePrimitiveNode calls createState if missing.
        // phase = 0.
        // execute runs: phase += 0.1 -> 0.1.
        // check result.

        let state = context.nodeState.get("test-node");
        expect(state).toBeDefined();
        expect(state.phase).toBeCloseTo(0.1);
        expect(result.fields.out).toBeCloseTo(0.1);

        // Next step
        result = sawtooth.execute({ fields: { freq: 1.0 }, }, config, context);
        state = context.nodeState.get("test-node");

        expect(state.phase).toBeCloseTo(0.2);
        expect(result.fields.out).toBeCloseTo(0.2);
    });

    it("should handle input frequency override", () => {
        (context as any).nodeId = "test-node-2";
        const config = { fields: {}, };
        const inputs = { fields: { freq: 2.0 }, }; // Override with 2Hz

        // 2.0 Hz. Math is dt / freq = 0.1 / 2.0 = 0.05
        const result = sawtooth.execute(inputs, config, context);
        const state = context.nodeState.get("test-node-2");

        expect(state.phase).toBeCloseTo(0.2);
        expect(result.fields.out).toBeCloseTo(0.2);
    });

    it("should wrap phase correctly", () => {
        (context as any).nodeId = "test-node-3";
        const config = { fields: {}, };

        // Manually seed state
        context.nodeState.set("test-node-3", { phase: 0.95 });

        const result = sawtooth.execute({ fields: { freq: 1.0 }, }, config, context);
        const state = context.nodeState.get("test-node-3");

        // 0.95 + 0.1 = 1.05 -> 0.05
        expect(state.phase).toBeCloseTo(0.05);
        expect(result.fields.out).toBeCloseTo(0.05);
    });

    it("should output random values for high frequency", () => {
        (context as any).nodeId = "test-node-4";
        const config = { fields: {}, };

        const result1 = sawtooth.execute({ fields: { freq: 60.0 }, }, config, context);
        const result2 = sawtooth.execute({ fields: { freq: 60.0 }, }, config, context);

        expect(result1.fields.out).toBeGreaterThanOrEqual(0);
        expect(result1.fields.out).toBeLessThan(1);
        expect(result2.fields.out).toBeGreaterThanOrEqual(0);
        expect(result2.fields.out).toBeLessThan(1);

        // Highly unlikely to be equal
        expect(result1.fields.out).not.toBe(result2.fields.out);
    });
});
