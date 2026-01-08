import { describe, it, expect } from 'vitest';
import { compileAndRun } from '../test/integration-utils';
import { defaultNodeRepository } from './repository';

describe('ID Resolution Integration', () => {
  it('should resolve source IDs to compiled IDs for implicit subgraphs (core.ifthen)', () => {
    // Graph:
    // [const 1] -> [ifthen input]
    //              [ifthen] containing:
    //                  [add] (a + b) -> result
    // The ifthen is triggered by const=1 (truthy).
    // We will verify that we can update [add] using its SOURCE ID.

    const ifNodeId = 'if_node';
    const innerNodeId = 'inner_add';
    const constId = 'const_val';

    const result = compileAndRun(
      {
        [constId]: { typeId: 'data.literal', values: { value: 1 }, x: 0, y: 0 },
        [ifNodeId]: {
          typeId: 'core.ifthen',
          x: 100, y: 0,
          values: { midi_in: [] }, // Initially empty, will receive trigger
          // Note: In tests, spatial containment is usually inferred from coordinates.
          // core.ifthen is wide/tall enough to contain inner_add?
          // We need to check core.ifthen definition for expected strict dimensions or if it's dynamic.
          // But 'getRegion' logic usually checks bounds.
          config: { width: 300, height: 300 }
        },
        [innerNodeId]: {
          typeId: 'math.add',
          values: { a: 1, b: 2 },
          x: 150, y: 50 // Inside if_node (100,0) -> 300x300 rect includes (150,50)
        }
      },
      [
        { from: constId, port: 'value', to: ifNodeId, portIn: 'midi_in' }
      ],
      ifNodeId, // Monitoring ifNodeId? No, we likely want to monitor inner node?
      // Wait, inner node output is not easily accessible via compileAndRun's 'monitor'
      // because monitoring relies on Top Level connection to 'out_node'.
      // If we connect 'inner_add' to 'out_node', it crosses the subgraph boundary?
      // implicit subgraphs allow connections out? Usually yes.
      // But for this test, we care about 'setNodeConfig' success.
      'result',
      (repo) => {
        // Ensure core.ifthen is registered (it is in ALL_PRIMITIVES)
      }
    );

    const { executor, updateConfig } = result;

    // 1. Initial State Check
    // Get Compiled ID
    // We can't ask executor for ID map directly (private), but we can check if config exists.

    // getNodeConfig should work with Source ID if resolution works
    const initialConfig = executor.getNodeConfig(innerNodeId);
    expect(initialConfig).toBeDefined();
    expect((initialConfig as any).values.a).toBe(1);

    // 2. Modify using Source ID
    updateConfig(innerNodeId, { values: { a: 42 } });

    // 3. Verify Update worked
    const updatedConfig = executor.getNodeConfig(innerNodeId);
    expect((updatedConfig as any).values.a).toBe(42);

    // 4. Verify Execution reflects update
    // We need to run update.
    executor.update({ clock: { beat: 0, dt: 1 } });

    // Note: To verify execution *result*, we'd need to inspect the node state output.
    // Since 'inner_add' is compiled to 'if_node.inner_add', let's peek at internal state if possible,
    // or trust getNodeConfig is enough for this specific "ID Resolution" test.
    // The User asked to test if it "works", implying "setNodeConfig works".

    // We can try to resolve it manually to verify it WAS mapped
    // (This relies on implementation details, but good for verification)
    // The compiled ID should be 'if_node.inner_add'
    const compiledId = 'if_node.' + innerNodeId;
    const rawState = (executor as any).nodeStates.get(compiledId);
    expect(rawState).toBeDefined();
    expect((rawState as any).config.values.a).toBe(42);

    // Verify source ID does NOT exist in nodeStates (it's mapped)
    const rawSourceState = (executor as any).nodeStates.get(innerNodeId);
    expect(rawSourceState).toBeUndefined();

  });
});
