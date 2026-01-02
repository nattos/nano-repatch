import { defineNode, registerNode } from "../../structor/node-helpers";
import { numberType, midiStreamType } from "../../structor/std-types";
import { StringType } from "../../structor/type-helpers";
import { StructorType } from "../../structor/structor";

const ADSR_PHASE = {
  IDLE: 0,
  ATTACK: 1,
  DECAY: 2,
  SUSTAIN: 3,
  RELEASE: 4
};

interface AdsrUIConfig {
  mode?: string;
  values?: { mode?: string };
}

type AdsrCompiledConfig = {
  mode: typeof StringType;
};

interface AdsrState {
  phase: number;
  value: number;
  time: number;
  activeNotes: number;
}

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
    decay: { type: numberType, defaultValue: 1.0, range: [0, 5], description: 'Decay Time (s)' },
    sustain: { type: numberType, defaultValue: 0.7, range: [0, 1], description: 'Sustain Level (0-1)' },
    release: { type: numberType, defaultValue: 1.0, range: [0, 5], description: 'Release Time (s)' }
  },

  config: {
    mode: { kind: 'atomic', type: 'string', defaultValue: 'D' }
  },
  ui: {
    inspector: {
      fields: [
        {
          label: 'Mode',
          path: 'mode',
          type: 'tab-bar',
          options: [
            { label: 'ADSR', value: 'ADSR' },
            { label: 'ADS', value: 'ADS' },
            { label: 'D', value: 'D' }
          ],
        }
      ]
    }
  },
  compileConfig: (uiConfig: AdsrUIConfig) => ({
    mode: uiConfig.mode || uiConfig.values?.mode || 'D'
  }),
  computeForwardPorts: (inputTypes, uiConfig) => {
    // uiConfig is now the result of compileConfig (flat data)
    const mode = uiConfig.mode || 'D';

    const fields: Record<string, StructorType> = {
      stream: midiStreamType
    };

    if (mode === 'ADSR') {
      fields.attack = numberType;
      fields.decay = numberType;
      fields.sustain = numberType;
      fields.release = numberType;
    } else if (mode === 'ADS') {
      fields.attack = numberType;
      fields.decay = numberType;
      fields.sustain = numberType;
      // No release
    } else if (mode === 'D') {
      fields.decay = numberType;
      // No attack, sustain, release
    }

    return {
      inputs: { kind: 'record', fields },
      outputs: { kind: 'record', fields: { value: numberType } }
    };
  },
  outputs: {
    value: { type: numberType, description: 'Envelope Value (0-1)' }
  },
  isRealtime: () => true,
  shouldRecompileOnConfigChange: (uiConfig) => {
    return true;
  },
  createState: (): AdsrState => ({
    phase: ADSR_PHASE.IDLE,
    value: 0.0,
    time: 0.0,
    activeNotes: 0
  }),
  execute: (inputs, config, context, state) => {
    const dt = context.clock.dt;
    // Strict config typing
    const mode = config.mode || 'D';
    const stream = inputs.stream;

    let attackTime = 0;
    let decayTime = 0;
    let sustainLevel = 0;
    let releaseTime = 0;

    if (mode === 'D') {
      attackTime = 0;
      decayTime = Math.max(0, inputs.decay ?? 0.1);
      sustainLevel = 0;
      releaseTime = decayTime;
    } else if (mode === 'ADS') {
      attackTime = Math.max(0, inputs.attack ?? 0.1);
      decayTime = Math.max(0, inputs.decay ?? 0.1);
      sustainLevel = Math.max(0, Math.min(1, inputs.sustain ?? 0.7));
      releaseTime = decayTime;
    } else {
      // ADSR
      attackTime = Math.max(0, inputs.attack ?? 0.1);
      decayTime = Math.max(0, inputs.decay ?? 0.1);
      sustainLevel = Math.max(0, Math.min(1, inputs.sustain ?? 0.7));
      releaseTime = Math.max(0, inputs.release ?? 0.5);
    }


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
        state.time = 0;
        break;

      case ADSR_PHASE.ATTACK:
        state.time += dt;
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
        state.time += dt;
        state.value -= ((1.0 - sustainLevel) / Math.max(0.001, decayTime)) * dt;
        if (state.value <= sustainLevel) {
          state.value = sustainLevel;
          state.phase = ADSR_PHASE.SUSTAIN;
          state.time = 0;
        }
        break;

      case ADSR_PHASE.SUSTAIN:
        state.time += dt;
        state.value = sustainLevel;
        break;

      case ADSR_PHASE.RELEASE:
        state.time += dt;
        if (releaseTime <= 0) {
          state.value = 0;
          state.phase = ADSR_PHASE.IDLE;
          state.time = 0;
        } else {
          state.value -= (1.0 / releaseTime) * dt;
          if (state.value <= 0) {
            state.value = 0;
            state.phase = ADSR_PHASE.IDLE;
            state.time = 0;
          }
        }
        break;
    }

    return {
      outputs: { value: Math.max(0, Math.min(1, state.value)) },
      // Send current value to UI for visualization (Hero Node)
      ui: { value: state.value, phase: state.phase, time: state.time }
    };
  },
  inspectInputs: true
});

registerNode(adsr);
