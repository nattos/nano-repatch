import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType, timeBaseEnum } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";

interface PendingEvent {
  event: MidiEvent;
  releaseTime: number; // Absolute time or Beat
}

interface MidiDelayState {
  queue: PendingEvent[];
}

import { TimeBaseModeField } from "../shared-inspector-fields";

const MidiDelayFields: InspectorFieldDef[] = [
  TimeBaseModeField
];

export const midiDelayNode = defineNode({
  id: "midi.delay",
  version: "1.0.0",
  displayName: "MIDI Delay",
  metadata: {
    category: NodeCategory.Utility,
    keywords: ['midi', 'delay', 'time', 'beats'],
    description: 'Delays MIDI events by a specified duration.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true },
    duration: { ...numberType, defaultValue: 0.25 }
  },
  config: {
    mode: { ...timeBaseEnum, defaultValue: 'time' }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  outputs: {
    stream: midiStreamType
  },
  ui: {
    inspector: { fields: MidiDelayFields }
  },
  isRealtime: () => true, // Always run to check queue
  createState: (): MidiDelayState => ({ queue: [] }),
  execute: (inputs, config, context, state) => {
    const stream = (inputs.stream || []) as MidiEvent[];
    const duration = inputs.duration || 0;
    const mode = config.mode || 'time';

    // Current Time Base
    let now = 0;
    if (mode === 'beats') {
      now = context.clock.beat;
    } else {
      now = context.time || 0;
    }

    // Defensive initialization
    if (!state.queue) {
      state.queue = [];
    }

    // 1. Enqueue new events
    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        state.queue.push({
          event,
          releaseTime: now + duration
        });
      }
    }

    // 2. Process Queue
    const outputStream: MidiEvent[] = [];
    const remainingQueue: PendingEvent[] = [];

    for (const item of state.queue) {
      if (item.releaseTime <= now) {
        outputStream.push(item.event);
      } else {
        remainingQueue.push(item);
      }
    }

    state.queue = remainingQueue;

    return { stream: outputStream };
  },
  compileConfig: (uiConfig: { mode?: string }) => ({
    mode: uiConfig.mode ?? 'time'
  })
});

registerNode(midiDelayNode);
