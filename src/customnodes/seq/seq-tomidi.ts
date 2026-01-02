import { defineNode, registerNode } from "../../structor/node-helpers";
import {
  midiStreamType,
  sequenceStructorType,
} from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";
import { Step } from "./types";

const SEQUENCE_LENGTH = 16;

/**
 * seq.tomidi (formerly nicepattern.pattern)
 * Combines multiple sequences into a MIDI stream.
 */
interface SeqToMidiInputs {
  seq_in: Step[][]; // Array of Sequences (from multi-connection)
}

interface SeqToMidiState {
  sequenceStates: Map<number, {
    lastStepIndex: number;
    lastNoteIndex: number | null;
    lastHold: boolean;
    activeNotes: Map<number, number>;
  }>;
}

// explicit 'any' generic removed - using strict inference
export const tomidi = defineNode({
  id: "seq.tomidi",
  version: "1.0.0",
  displayName: "To MIDI",
  metadata: {
    category: 'Sequence',
    keywords: ['pattern', 'sequencer', 'combiner', 'event', 'midi'],
    description: 'Converts sequence(s) into a MIDI stream.'
  },
  config: {},
  inputs: {
    seq_in: {
      type: sequenceStructorType,
      description: "Input sequence(s)",
      allowMultiConnection: true
    }
  },
  outputs: { midi_out: midiStreamType },
  autoBroadcast: true,
  reshape: 'none',
  isRealtime: () => true,
  createState: (): SeqToMidiState => ({
    sequenceStates: new Map()
  }),
  execute: (inputs, config, context, state) => {
    // Inputs are strictly typed now!
    // inputs.seq_in is inferred as Step[][] because sequenceStructorType is array of Step
    // Updated definition means seqs is correctly inferred as Step[][]
    const rawSeqs = (inputs.seq_in || []) as any[];

    // Normalize inputs: Handle potential double-wrapping (Step[][][] -> Step[][])
    let seqs = rawSeqs;
    if (seqs.length === 1 && Array.isArray(seqs[0]) && seqs[0].length > 0 && Array.isArray(seqs[0][0])) {
      seqs = seqs[0];
    }

    const stream: MidiEvent[] = [];
    const stepsPerBeat = 4;
    const absoluteStep = Math.floor(context.clock.beat * stepsPerBeat);
    const currentStepIndex = ((absoluteStep % SEQUENCE_LENGTH) + SEQUENCE_LENGTH) % SEQUENCE_LENGTH;

    // Process all sequences (both current inputs and previously active ones)
    const seqIndices = new Set<number>();
    seqs.forEach((_, i) => seqIndices.add(i));
    state.sequenceStates.forEach((_, i) => seqIndices.add(i));

    for (const seqIndex of seqIndices) {
      const seq = seqs[seqIndex]; // Step[] | undefined

      // Initialize state for this sequence if missing
      if (!state.sequenceStates.has(seqIndex)) {
        state.sequenceStates.set(seqIndex, {
          lastStepIndex: -1,
          lastNoteIndex: null,
          lastHold: false,
          activeNotes: new Map<number, number>()
        });
      }
      const seqState = state.sequenceStates.get(seqIndex)!;

      // If seq is gone and no active note, cleanup
      if (!seq && seqState.lastNoteIndex === null) {
        state.sequenceStates.delete(seqIndex);
        continue;
      }

      let currentStep: { noteIndex: number | null, velocity: number, hold: boolean } = { noteIndex: null, velocity: 0, hold: false };

      if (seq && seq[currentStepIndex]) {
        currentStep = seq[currentStepIndex];
      }

      // Check if we need to update
      if (currentStepIndex !== seqState.lastStepIndex || !seq || currentStep.noteIndex !== seqState.lastNoteIndex) {

        const lastNoteIndex = seqState.lastNoteIndex;
        const lastHold = seqState.lastHold;

        const isNoteActive = currentStep.noteIndex !== null && currentStep.noteIndex !== undefined;
        const isSameNote = isNoteActive && currentStep.noteIndex === lastNoteIndex;

        const shouldRelease = (lastNoteIndex !== null) && (!isSameNote || !lastHold);
        const shouldTrigger = isNoteActive && (!isSameNote || !lastHold);

        if (shouldRelease && lastNoteIndex !== null) {
          stream.push({
            type: 'note_off',
            note: lastNoteIndex,
            velocity: 0,
            channel: 1,
            deviceId: 'tomidi',
            time: 0
          });
          seqState.activeNotes.delete(lastNoteIndex);
          seqState.lastNoteIndex = null;
          seqState.lastHold = false;
        }

        if (shouldTrigger && currentStep.noteIndex !== null) {
          stream.push({
            type: 'note_on',
            note: currentStep.noteIndex,
            velocity: currentStep.velocity,
            channel: 1,
            deviceId: 'tomidi',
            time: 0
          });
          seqState.activeNotes.set(currentStep.noteIndex, currentStep.velocity);
          seqState.lastNoteIndex = currentStep.noteIndex;
          seqState.lastHold = currentStep.hold;
        } else if (isSameNote && lastHold) {
          seqState.lastHold = currentStep.hold;
        }

        seqState.lastStepIndex = currentStepIndex;
      }
    }

    return { midi_out: stream };
  },
});

registerNode(tomidi);
