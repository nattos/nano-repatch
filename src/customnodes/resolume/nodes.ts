import { definePrimitiveNode, defineType } from '../../structor/type-helpers';
import { resolumeManager } from '../../io/resolume/manager';
import { Structor } from '../../structor/structor';

const anyType = defineType({ kind: 'atomic', type: 'any' });
const stringType = defineType({ kind: 'atomic', type: 'string' });

export const resolumeInputNode = definePrimitiveNode({
  id: 'resolume:input',
  inputs: {},
  config: {
    path: stringType
  },
  outputs: {
    value: anyType
  },
  autoBroadcast: false,
  isRealtime: () => true, // Inputs change over time

  createState: (config, context) => {
    // Initial state
    const state = { value: 0 as any, unsubscribe: () => { } };

    if (config.path) {
      const callback = (val: any) => {
        state.value = val;
        // Mark dirty? The manager doesn't know about the graph.
        // We need a way to trigger graph update.
        // The node itself is dirty if its state changes?
        // Currently, dirty tracking is from inputs.
        // If a node's internal state changes, it needs to tell the executor?
        // The executor polls? Or we need a mechanism to push updates.
        // For now, let's assume the graph loop runs or we need to trigger it.
        // The `ExecutionContext` doesn't have a `markDirty` method exposed to `execute`.
        // But `createState` is called once.

        // HACK: We need to trigger a graph update.
        // We can use `appController`? No, that's UI.
        // We need access to the runtime.
        // For now, let's just update the state object.
        // If the graph is running in a loop (e.g. requestAnimationFrame), it will pick it up next frame.
      };

      resolumeManager.subscribe(config.path, callback);
      state.unsubscribe = () => resolumeManager.unsubscribe(config.path, callback);
    }

    return state;
  },

  execute: (inputs, config, context, state) => {
    return { value: state?.value ?? 0 };
  }
});

export const resolumeOutputNode = definePrimitiveNode({
  id: 'resolume:output',
  inputs: {
    value: anyType
  },
  config: {
    path: stringType
  },
  outputs: {},
  autoBroadcast: true,

  execute: (inputs, config, context) => {
    if (config.path && inputs.value !== undefined) {
      // Only send if changed? ResolumeManager or Client should handle dedup if needed.
      // But we don't want to flood WS.
      // For now, send every frame.
      resolumeManager.setValue(config.path, inputs.value);
    }
    return {};
  }
});
