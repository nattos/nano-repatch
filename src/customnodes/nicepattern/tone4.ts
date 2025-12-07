
import { defineNode } from "../../structor/node-helpers";
import { numberType } from "../../structor/std-types";
import { vec4Type } from "./orthomod";
import { VirtualAudioContext, VirtualOscillatorNode, VirtualGainNode } from "../../audio/virtual-audio";

interface Tone4State {
  initialized: boolean;
  masterGain: VirtualGainNode | null;
  voices: {
    osc: VirtualOscillatorNode;
    gain: VirtualGainNode;
    freqRatio: number;
    wave: string;
  }[];
  lastRoot: number;
}

export const tone4 = defineNode({
  id: "nicepattern.tone4",
  version: "1.0.0",
  displayName: "Tone 4",
  metadata: {
    category: 'NicePattern',
    keywords: ['synth', 'additive', 'oscillator', 'audio'],
    description: '4-voice additive synth driven by vector input.'
  },
  inputs: {
    vec: { type: vec4Type, description: "Modulation Vector [c1, c2, c3, c4]" },
    root: { type: numberType, defaultValue: 73.42, description: "Root Frequency (Hz)", range: [20, 2000] },
    gain: { type: numberType, defaultValue: 0.5, description: "Master Volume" }
  },
  outputs: {}, // Audio output is internal/side-effect
  isRealtime: () => true,
  createState: () => ({
    initialized: false,
    masterGain: null,
    voices: [],
    lastRoot: -1
  }),
  execute: (inputs, config, context, state: Tone4State) => {
    const audio = context.audio?.context;
    if (!audio) return {}; // No audio context, do nothing

    const now = audio.currentTime;

    // Initialize Audio Graph
    if (!state.initialized) {
      // Create Master
      state.masterGain = audio.createGain();
      state.masterGain.connect(audio.destination);

      // Create Voices
      // Prototype: [73.42, 110.00, 146.83, 220.00]
      // Ratios approx: 1.0, 1.5, 2.0, 3.0
      const ratios = [1.0, 1.5, 2.0, 3.0];
      const waves = ['square', 'sawtooth', 'triangle', 'sine'];

      state.voices = ratios.map((ratio, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();

        osc.type = waves[i];
        osc.connect(gain);
        gain.connect(state.masterGain!);
        osc.start(now);
        gain.gain.setValueAtTime(0, now); // Start silent

        return { osc, gain, freqRatio: ratio, wave: waves[i] };
      });

      state.initialized = true;
    }

    // Update Master Volume
    const masterVol = Math.max(0, Math.min(1, inputs.gain ?? 0.5));
    if (state.masterGain) {
        state.masterGain.gain.setTargetAtTime(masterVol, now, 0.05);
    }

    // Update Frequencies (if changed)
    const rootRaw = inputs.root;
    // Clamp root to safe audio range
    const root = (typeof rootRaw === 'number' && Number.isFinite(rootRaw))
        ? Math.max(20, Math.min(2000, rootRaw))
        : 73.42;

    if (Math.abs(root - state.lastRoot) > 0.01) {
        state.voices.forEach(v => {
            v.osc.frequency.setTargetAtTime(root * v.freqRatio, now, 0.05);
        });
        state.lastRoot = root;
    }

    // Update Voice Gains from Vector
    const vecRaw = inputs.vec;
    const vec = (Array.isArray(vecRaw) && vecRaw.length === 4) ? vecRaw : [0, 0, 0, 0];

    state.voices.forEach((v, i) => {
        const val = Math.max(0, Math.min(1, vec[i] ?? 0));
        // Use smoothing to avoid clicks
        v.gain.gain.setTargetAtTime(val, now, 0.02);
    });

    return {};
  }
});
