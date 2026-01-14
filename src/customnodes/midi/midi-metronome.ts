
import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType, timeBaseEnum } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";
import { TimeBaseModeField, BeatDenomField } from "../shared-inspector-fields";

interface MetronomeState {
  lastTriggerTime: number; // Absolute time or Beat
  noteActive: boolean;
}

const MetronomeFields: InspectorFieldDef[] = [
  TimeBaseModeField,
  BeatDenomField,
  {
    type: 'number',
    label: 'Note',
    path: 'note',
    min: 0,
    max: 127,
    default: 60
  }
];

export const midiMetronomeNode = defineNode({
  id: "midi.metronome",
  version: "1.0.0",
  displayName: "Metronome",
  metadata: {
    category: NodeCategory.Utility,
    keywords: ['midi', 'metronome', 'clock', 'beat', 'trigger'],
    description: 'Generates MIDI note events at regular intervals.'
  },
  inputs: {
    duration: { ...numberType, defaultValue: 1.0, description: 'Interval duration (seconds or beats)', min: 0.0, max: 4.0 }
  },
  config: {
    mode: { ...timeBaseEnum, defaultValue: 'time' },
    beatDenom: { ...numberType, defaultValue: 0.25 },
    note: { ...numberType, defaultValue: 60 }
  },
  outputs: {
    stream: midiStreamType
  },
  ui: {
    inspector: { fields: MetronomeFields }
  },
  isRealtime: () => true,
  createState: (): MetronomeState => ({ lastTriggerTime: -99999, noteActive: false }),
  execute: (inputs, config, context, state) => {
    const durationInput = inputs.duration || 1.0;
    const mode = config.mode || 'time';
    const beatDenom = config.beatDenom || 0.25;
    const noteNumber = config.note || 60;

    let now = 0;
    let interval = durationInput;

    if (mode === 'beats') {
      now = context.clock.beat;
      // Quantize interval. `durationInput` is in multiples of `beatDenom`.
      const steps = Math.round(durationInput);
      interval = steps * beatDenom * 4; // Beat number (context.clock.beat) assumes 4 beats per bar

      if (interval <= 0) interval = beatDenom; // Prevent infinite loop / zero interval
    } else {
      now = context.time || 0;
    }

    const outputStream: MidiEvent[] = [];

    // Initialize state
    if (state.lastTriggerTime === -99999) {
      state.lastTriggerTime = now;
      return { stream: [] };
    }

    const prev = state.lastTriggerTime;

    // Calculate expected trigger points between prev and now.
    // Range: (prev, now]
    // Trigger points are k * interval.

    const startStep = Math.floor(prev / interval);
    const endStep = Math.floor(now / interval);

    // If endStep > startStep, we crossed one or more boundaries.
    const triggers = endStep - startStep;

    for (let i = 1; i <= triggers; i++) {
      const triggerTime = (startStep + i) * interval;

      // Note On
      outputStream.push({
        type: 'note_on',
        deviceId: 'metronome',
        channel: 1,
        note: noteNumber,
        velocity: 1.0,
        time: 0 // Immediate execution relative to block
      });

      // Note Off (immediately after)
      outputStream.push({
        type: 'note_off',
        deviceId: 'metronome',
        channel: 1,
        note: noteNumber,
        velocity: 0,
        time: 0
      });
    }

    state.lastTriggerTime = now;

    return { stream: outputStream };
  },
  compileConfig: (uiConfig: any) => ({
    mode: uiConfig.mode ?? 'time',
    beatDenom: uiConfig.beatDenom ?? 0.25,
    note: uiConfig.note ?? 60
  })
});

registerNode(midiMetronomeNode);
