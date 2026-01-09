
import { describe, it, expect } from 'vitest';
import { midiTriggerNode } from './midi-trigger';
import { AnalysisContext } from '../../structor/structor';

describe('midi.trigger', () => {
  it('should not fire on initialization with persisted trigger value', () => {
    // 1. Simulate persisted config with a high trigger value (as if previously clicked)
    const persistedConfig = {
      pitch: 60,
      velocity: 1.0,
      trigger: 12345 // Simulating a timestamp or ID from previous session
    };

    // 2. Create state
    const state = midiTriggerNode.createState();
    // state is { lastTrigger: 0, initialized: false }

    // We expect the FIX to initialize lastTrigger to persistedConfig.trigger
    // But currently it is 0.

    // 3. Execute first frame
    const context: any = {
      clock: { dt: 0.016 },
      markSelfDirty: () => { },
      nodeState: new Map(), // Mock nodeState
      nodeId: 'test-node'
    };

    // Pre-populate state to simulate persistence?
    // No, defineNode handles state creation internally if we use execute wrapper.
    // But here we are calling the definition's execute?
    // Wait, midiTriggerNode IS the definition (result of defineNode).
    // defineNode wraps the execution logic.
    // So if we call midiTriggerNode.execute, we are calling the wrapped function.
    // The wrapped function CHECKS context.nodeState.


    const inputs = {
      fields: {
        trigger: { kind: 'atomic', type: 'number', value: 12345 }
      }
    }; // Simulate the persisted value propagating to input via StructorRecord

    const result = midiTriggerNode.execute(inputs, persistedConfig, context, state);

    // 4. Assert
    // result is StructorRecord { fields: { stream: ... } }
    const stream = (result as any).fields.stream;

    // BUG: With persisted trigger: 12345, and initialized lastTrigger: 0
    // 12345 > 0 -> Trigger fires immediately.
    // If we want to confirm the bug: expect(stream).toHaveLength(2);
    // If we want to assert correct behavior (once fixed): expect(stream).toHaveLength(0);

    // For reproduction step, I will assert validation failure (that it HAS length > 0)
    // Actually, I'll write the expectation of the FIX. So the test should FAIL now.
    expect(stream).toHaveLength(0);
  });

  it('should fire strictly on rising edge', () => {
    const config = { pitch: 60, velocity: 1.0, trigger: 0 };
    const state = midiTriggerNode.createState();
    const context: any = {
      clock: { dt: 0.016 },
      markSelfDirty: () => { },
      nodeState: new Map(),
      nodeId: 'test-node-2'
    };

    // Initial state
    const inputs = { fields: { trigger: { kind: 'atomic', type: 'number', value: 0 } } };
    let result = midiTriggerNode.execute(inputs, config, context, state);
    expect((result as any).fields.stream).toHaveLength(0);

    // Trigger!
    // We simulate a UI update where config.trigger changes, OR an input trigger.
    // The node logic checks `trigger > state.lastTrigger`.
    // Wait, the node has TWO trigger sources: `config.trigger` and `inputs.trigger`.
    // Code: `const trigger = inputs.trigger || 0;`
    // Wait, let me check the code again.
    // `const trigger = inputs.trigger || 0;` - this seemingly IGNORES config.trigger for execution!
    // But the user says "propagating trigger through a config value".
    // Let's re-read the file.
  });
});
