import { defineNode, registerNode } from "../../structor/node-helpers";
import {
  midiStreamType,
  sequenceStructorType,
  numberType,
} from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";
import { Step } from "./types";

interface SeqOneShotInputs {
  seq_in: Step[];
  trigger: MidiEvent[];
  duration: number;
}

interface SeqOneShotState {
  isPlaying: boolean;
  startTime: number;
  lastStepIndex: number;
  lastNoteIndex: number | null;
  lastHold: boolean;
  activeNotes: Map<number, number>;
}

export const oneshot = defineNode({
  id: "seq.oneshot",
  version: "1.0.0",
  displayName: "One Shot",
  metadata: {
    category: 'Sequence',
    keywords: ['player', 'trigger', 'oneshot', 'envelope'],
    description: 'Plays a sequence once upon trigger.'
  },
  config: {},
  autoBroadcast: {
    trigger: { combine: { reduce: 'flatten' } },
    seq_in: { combine: { reduce: 'first' } }
  },
  inputs: {
    seq_in: { type: sequenceStructorType, description: "Input sequence" },
    trigger: { type: midiStreamType, description: "Trigger", allowMultiConnection: true },
    duration: { type: numberType, defaultValue: 4.0, description: "Duration (s)" }
  },
  outputs: { midi_out: midiStreamType },
  isRealtime: () => true,
  createState: (): SeqOneShotState => ({
    isPlaying: false,
    startTime: 0,
    lastStepIndex: -1,
    lastNoteIndex: null,
    lastHold: false,
    activeNotes: new Map()
  }),
  execute: (inputs, config, context, state) => {
    // strict
    // Process Trigger
    const triggerStream = (inputs.trigger || []) as MidiEvent[];
    let triggered = false;
    if (Array.isArray(triggerStream)) {
      for (const e of triggerStream) {
        if (e.type === 'note_on' && e.velocity > 0) {
          triggered = true;
          break;
        }
      }
    }


    // Use audio time (seconds) for duration-based playback
    const currentTime = context.audio?.context?.currentTime ?? 0;

    if (triggered) {
      state.isPlaying = true;
      state.startTime = currentTime;
    }

    const seq = inputs.seq_in || [];

    const stream: MidiEvent[] = [];

    if (!state.isPlaying || !seq || seq.length === 0) {
      if (state.lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: state.lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'oneshot' });
        state.lastNoteIndex = null;
        state.lastHold = false;
      }
      if (state.activeNotes.size > 0) {
        state.activeNotes.clear();
      }
      return { midi_out: stream };
    }

    const duration = Math.max(0.001, inputs.duration ?? 4.0);
    const elapsed = currentTime - state.startTime;
    const t = elapsed / duration;

    if (t >= 1.0) {
      state.isPlaying = false;
      if (state.lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: state.lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'oneshot' });
        state.lastNoteIndex = null;
        state.lastHold = false;
      }
      return { midi_out: stream };
    }

    const stepCount = seq.length;
    const currentStepIndex = Math.floor(t * stepCount);

    let currentStep: Step = { noteIndex: null, velocity: 0, hold: false };
    if (seq[currentStepIndex]) {
      currentStep = seq[currentStepIndex];
    }

    if (currentStepIndex !== state.lastStepIndex || currentStep.noteIndex !== state.lastNoteIndex) {
      const lastNoteIndex = state.lastNoteIndex;
      const lastHold = state.lastHold;
      const isNoteActive = currentStep.noteIndex !== null;
      const isSameNote = isNoteActive && currentStep.noteIndex === lastNoteIndex;

      const shouldRelease = (lastNoteIndex !== null) && (!isSameNote || !lastHold);
      const shouldTrigger = isNoteActive && (!isSameNote || !lastHold);

      if (shouldRelease && lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'oneshot' });
        state.activeNotes.delete(lastNoteIndex);
        state.lastNoteIndex = null;
        state.lastHold = false;
      }

      if (shouldTrigger && currentStep.noteIndex !== null) {
        stream.push({ type: 'note_on', note: currentStep.noteIndex, velocity: currentStep.velocity, channel: 1, time: 0, deviceId: 'oneshot' });
        state.activeNotes.set(currentStep.noteIndex, currentStep.velocity);
        state.lastNoteIndex = currentStep.noteIndex;
        state.lastHold = currentStep.hold;
      } else if (isSameNote && lastHold) {
        state.lastHold = currentStep.hold;
      }
      state.lastStepIndex = currentStepIndex;
    }

    return { midi_out: stream };
  }
});


interface SeqScanInputs {
  seq_in: Step[];
  pos: number;
}

interface SeqScanState {
  lastStepIndex: number;
  lastNoteIndex: number | null;
  lastHold: boolean;
  activeNotes: Map<number, number>;
}

export const scan = defineNode({
  id: "seq.scan",
  version: "1.0.0",
  displayName: "Scan Sequence",
  metadata: {
    category: 'Sequence',
    keywords: ['player', 'scan', 'scrub'],
    description: 'Plays a sequence by scanning through positions.'
  },
  config: {},
  autoBroadcast: {
    seq_in: { combine: { reduce: 'first' } }
  },
  inputs: {
    seq_in: { type: sequenceStructorType, description: "Input sequence" },
    pos: { type: numberType, defaultValue: 0, description: "Position (0-1)" }
  },
  outputs: { midi_out: midiStreamType },
  isRealtime: () => true,
  createState: (): SeqScanState => ({
    lastStepIndex: -1,
    lastNoteIndex: null,
    lastHold: false,
    activeNotes: new Map()
  }),
  execute: (inputs, config, context, state) => {
    // strict
    const seq = (inputs.seq_in || []) as Step[];
    const pos = inputs.pos ?? 0;
    const stream: MidiEvent[] = [];

    if (!seq || seq.length === 0 || pos >= 1.0 || pos < 0) {
      if (state.lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: state.lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'scan' });
        state.lastNoteIndex = null;
        state.lastHold = false;
      }
      return { midi_out: stream };
    }

    const stepCount = seq.length;
    const currentStepIndex = Math.floor(pos * stepCount);

    let currentStep: Step = { noteIndex: null, velocity: 0, hold: false };
    if (seq[currentStepIndex]) {
      currentStep = seq[currentStepIndex];
    }

    if (currentStepIndex !== state.lastStepIndex || currentStep.noteIndex !== state.lastNoteIndex) {
      const lastNoteIndex = state.lastNoteIndex;
      const lastHold = state.lastHold;
      const isNoteActive = currentStep.noteIndex !== null;
      const isSameNote = isNoteActive && currentStep.noteIndex === lastNoteIndex;

      const shouldRelease = (lastNoteIndex !== null) && (!isSameNote || !lastHold);
      const shouldTrigger = isNoteActive && (!isSameNote || !lastHold);

      if (shouldRelease && lastNoteIndex !== null) {
        stream.push({ type: 'note_off', note: lastNoteIndex, velocity: 0, channel: 1, time: 0, deviceId: 'scan' });
        state.lastNoteIndex = null;
        state.lastHold = false;
      }

      if (shouldTrigger && currentStep.noteIndex !== null) {
        stream.push({ type: 'note_on', note: currentStep.noteIndex, velocity: currentStep.velocity, channel: 1, time: 0, deviceId: 'scan' });
        state.lastNoteIndex = currentStep.noteIndex;
        state.lastHold = currentStep.hold;
      } else if (isSameNote && lastHold) {
        state.lastHold = currentStep.hold;
      }
      state.lastStepIndex = currentStepIndex;
    }

    return { midi_out: stream };
  }
});

registerNode(oneshot);
registerNode(scan);
