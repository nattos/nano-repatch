import { defineNode, registerNode } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { NumberType } from "../../structor/type-helpers";
import { MidiEvent } from "../../io/midi/types";

interface MidiTriggerInputs {
  trigger: number;
}

// strict type inference
export const midiTriggerNode = defineNode({
  id: "midi.trigger",
  version: "1.0.0",
  displayName: "MIDI Trigger",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'trigger', 'bang', 'button'],
    description: 'Manually sends a Middle C Note On/Off pair when triggered.'
  },
  inputs: {
    trigger: { type: numberType, description: 'Trigger Signal', suppressInputEditor: true }
  },
  config: {
    pitch: { ...numberType, defaultValue: 60 },
    velocity: { ...numberType, defaultValue: 1.0, range: [0, 1] },
    trigger: numberType
  },
  outputs: {
    stream: midiStreamType
  },
  isRealtime: () => true,
  createState: (): { lastTrigger: number } => ({ lastTrigger: 0 }),
  execute: (inputs, config, context, state) => {
    // Inputs are strictly typed
    const pitch = config.pitch || 60;
    const velocity = config.velocity || 1.0;
    const trigger = inputs.trigger || 0;
    const dt = context.clock.dt;

    const stream: MidiEvent[] = [];

    // Logic: Pulse / Trigger
    // Rising Edge -> Note On + Start Timer (0.1s default duration)
    // Timer Expire -> Note Off
    // Falling Edge -> Note Off (Early release)

    if (trigger > state.lastTrigger) {
      // Rising Edge: Synchronous Trigger (Note On then Note Off)
      const vel = Math.floor(velocity * 127);
      stream.push({ type: 'note_on', channel: 1, note: pitch, velocity: vel, deviceId: 'virtual', time: 0 });
      stream.push({ type: 'note_off', channel: 1, note: pitch, velocity: 0, deviceId: 'virtual', time: 0 });
    }

    state.lastTrigger = trigger;

    return { stream };
  },
  compileConfig: (uiConfig: { pitch?: number, velocity?: number, trigger?: number }) => ({
    pitch: uiConfig.pitch ?? 60,
    velocity: uiConfig.velocity ?? 1.0,
    trigger: uiConfig.trigger
  }),
  ui: {
    inspector: {
      fields: [
        { type: 'button', label: 'Trigger', path: 'trigger', text: 'Bang' },
        { type: 'number', label: 'Pitch', path: 'pitch', min: 0, max: 127, step: 1, default: 60 },
        { type: 'number', label: 'Velocity', path: 'velocity', min: 0, max: 1, step: 0.01, default: 1.0 }
      ]
    }
  }
});

registerNode(midiTriggerNode);
