
import { defineNode, registerNode } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { numberType } from "../../structor/std-types";

// --- Time Node ---
export const timeNode = defineNode({
  id: "time.time",
  version: "1.0.0",
  displayName: "Time",
  metadata: {
    category: NodeCategory.Utility,
    keywords: ['time', 'seconds', 'clock'],
    description: 'Outputs the current execution time in seconds.'
  },
  inputs: {},
  outputs: {
    time: numberType,
    delta: numberType
  },
  isRealtime: () => true,
  execute: (inputs, config, context) => {
    return {
      time: context.time || 0,
      delta: context.clock.dt || 0
    };
  }
});

// --- Beat Node ---
export const beatNode = defineNode({
  id: "time.beat",
  version: "1.0.0",
  displayName: "Beat",
  metadata: {
    category: NodeCategory.Utility,
    keywords: ['beat', 'bar', 'clock', 'tempo'],
    description: 'Outputs the current beat number.'
  },
  inputs: {},
  outputs: {
    beat: numberType,
    delta: numberType
  },
  isRealtime: () => true,
  createState: () => ({ lastBeat: -1 }),
  execute: (inputs, config, context, state) => {
    const currentBeat = context.clock.beat || 0;

    let delta = 0;
    if (state.lastBeat >= 0) {
      delta = currentBeat - state.lastBeat;
    }
    state.lastBeat = currentBeat;

    return {
      beat: currentBeat,
      delta: delta
    };
  }
});

// Register
registerNode(timeNode);
registerNode(beatNode);
