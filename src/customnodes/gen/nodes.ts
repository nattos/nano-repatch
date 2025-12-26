import { defineNode, registerNode } from "../../structor/node-helpers";
import { numberType, midiStreamType } from "../../structor/std-types";

export const sawtooth = defineNode({
  id: "gen.sawtooth",
  version: "1.0.0",
  displayName: "Sawtooth",
  metadata: {
    category: 'Oscillator',
    keywords: ['oscillator', 'sawtooth', 'ramp', 'lfo', 'generator'],
    description: 'Generates a linear sawtooth wave (0.0 to 1.0) at the given frequency.'
  },
  inputs: {
    freq: {
      type: numberType,
      defaultValue: 1.0,
      range: [0, 60],
      description: 'Frequency in Hz'
    }
  },
  outputs: { out: numberType },
  autoBroadcast: true,
  isRealtime: () => true,
  createState: () => ({
    phase: 0
  }),
  execute: (inputs, config, context, state) => {
    const freq = inputs.freq;
    const dt = context.clock.dt;

    if (freq >= 60.0 - 1e-6) {
      return { out: Math.random() };
    }

    // Accumulate phase
    state.phase += dt * freq;
    state.phase -= Math.floor(state.phase);

    return { out: state.phase };
  },
});

registerNode(sawtooth);

const ADSR_PHASE = {
  IDLE: 0,
  ATTACK: 1,
  DECAY: 2,
  SUSTAIN: 3,
  RELEASE: 4
};

export const adsr = defineNode({
  id: "gen.adsr",
  version: "1.0.0",
  displayName: "ADSR",
  metadata: {
    category: 'Envelope',
    keywords: ['envelope', 'adsr', 'modulation'],
    description: 'Attack-Decay-Sustain-Release envelope generator triggered by MIDI.'
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  inputs: {
    stream: { type: midiStreamType, description: 'MIDI Stream', allowMultiConnection: true },
    attack: { type: numberType, defaultValue: 0.1, range: [0, 5], description: 'Attack Time (s)' },
    decay: { type: numberType, defaultValue: 0.1, range: [0, 5], description: 'Decay Time (s)' },
    sustain: { type: numberType, defaultValue: 0.7, range: [0, 1], description: 'Sustain Level (0-1)' },
    release: { type: numberType, defaultValue: 0.5, range: [0, 5], description: 'Release Time (s)' }
  },
  outputs: {
    value: { type: numberType, description: 'Envelope Value (0-1)' }
  },
  isRealtime: () => true,
  createState: () => ({
    phase: ADSR_PHASE.IDLE,
    value: 0.0,
    time: 0.0,
    activeNotes: 0
  }),
  execute: (inputs, config, context, state) => {
    const dt = context.clock.dt;
    const stream = inputs.stream;

    const attackTime = Math.max(0, inputs.attack);
    const decayTime = Math.max(0, inputs.decay);
    const sustainLevel = Math.max(0, Math.min(1, inputs.sustain));
    const releaseTime = Math.max(0, inputs.release);

    if (Array.isArray(stream)) {
      for (const e of stream) {
        if (e.type === 'note_on' && (e.velocity ?? 0) > 0) {
          state.activeNotes++;
          if (state.activeNotes === 1) {
            // Trigger Attack
            state.phase = ADSR_PHASE.ATTACK;
            state.value = 0; // Reset value on new trigger? Or continue from current? Usually reset or retrigger.
            // Standard ADSR often restarts or continues.
            // Ideally: continue, but for mono Trigger, usually reset if it was off.
            // If it was releasing, we pick up from there?
            // "Legacy" behavior was reset. Let's stick to simple first unless requested.
            // Actually, for "Zero Attack", we need to know if we just started.
            state.time = 0;

            // Instant Attack Handling
            if (attackTime <= 0) {
              state.value = 1.0;
              state.phase = ADSR_PHASE.DECAY;
              state.time = 0;

              // Instant Decay Handling
              if (decayTime <= 0) {
                state.value = sustainLevel;
                state.phase = ADSR_PHASE.SUSTAIN;
              }
            }
          }
        } else if (e.type === 'note_off' || (e.type === 'note_on' && (e.velocity ?? 0) === 0)) {
          state.activeNotes = Math.max(0, state.activeNotes - 1);
        }
      }
    }

    // Check for Release transition
    if (state.activeNotes === 0 && state.phase !== ADSR_PHASE.IDLE && state.phase !== ADSR_PHASE.RELEASE) {
      state.phase = ADSR_PHASE.RELEASE;
      state.time = 0;
    }

    switch (state.phase) {
      case ADSR_PHASE.IDLE:
        state.value = 0;
        break;

      case ADSR_PHASE.ATTACK:
        state.value += (1.0 / Math.max(0.001, attackTime)) * dt;
        if (state.value >= 1.0) {
          state.value = 1.0;
          state.phase = ADSR_PHASE.DECAY;
          state.time = 0;

          // Handle Instant Decay if we just finished Attack naturally
          if (decayTime <= 0) {
            state.value = sustainLevel;
            state.phase = ADSR_PHASE.SUSTAIN;
          }
        }
        break;

      case ADSR_PHASE.DECAY:
        // Linear decay for simplicity, or exponential?
        // Original was linear.
        state.value -= ((1.0 - sustainLevel) / Math.max(0.001, decayTime)) * dt;
        if (state.value <= sustainLevel) {
          state.value = sustainLevel;
          state.phase = ADSR_PHASE.SUSTAIN;
        }
        break;

      case ADSR_PHASE.SUSTAIN:
        state.value = sustainLevel;
        break;

      case ADSR_PHASE.RELEASE:
        if (releaseTime <= 0) {
          state.value = 0;
          state.phase = ADSR_PHASE.IDLE;
        } else {
          state.value -= (1.0 / releaseTime) * dt;
          if (state.value <= 0) {
            state.value = 0;
            state.phase = ADSR_PHASE.IDLE;
          }
        }
        break;
    }

    return { value: Math.max(0, Math.min(1, state.value)) };
  }
});

registerNode(adsr);
