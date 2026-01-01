import { defineNode, registerNode } from "../../structor/node-helpers";
import { midiStreamType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";
import { Step } from "./envelope-generator";
import { ToneSynthLayer } from "./layers";
import { layerOutputStructorType } from "./nice-types";

interface ToneSynthState {
  layer: ToneSynthLayer;
  lastActive: boolean;
  lastActiveNote: number | null;
  activeVelocity: number;
  contextId: string;
}

export const toneSynthLayer = defineNode<any, {}, {}, any, ToneSynthState>({
  id: "nicepattern.tone_synth_layer",
  version: "1.0.0",
  displayName: "Tone Synth Layer",
  metadata: {
    category: 'NicePattern',
    keywords: ['synth', 'audio', 'sound', 'tone'],
    description: 'Simple synthesizer layer using Tone.js.'
  },
  config: {}, // Removed targetNote
  inputs: {
    midi_in: { type: midiStreamType, description: "Input MIDI stream", allowMultiConnection: true },
    prev_layer: { type: layerOutputStructorType, description: "Previous layer output" }
  },
  outputs: { out: layerOutputStructorType },
  autoBroadcast: {
    midi_in: { combine: { reduce: 'flatten' } }
  },
  ui: { inspector: { fields: [] } }, // Removed LayerFields
  isRealtime: () => true,
  createState: (config, context) => {
    return {
      layer: new ToneSynthLayer({}),
      lastActive: false,
      lastActiveNote: null as number | null,
      activeVelocity: 0,
      contextId: ''
    };
  },
  execute: (inputs, config, context, state) => {
    // Check for Audio Context Reset/Invalidation
    const audioContext = context.audio?.context;
    // Ensure layer exists (resilience against state corruption or bad init)
    if (!state.layer) {
      state.layer = new ToneSynthLayer({});
    }

    if (audioContext && state.contextId !== audioContext.contextId) {
      state.layer = new ToneSynthLayer({});
      state.contextId = audioContext.contextId;
    }

    const activeLayer = state.layer;
    const stream = (inputs.midi_in || []).flat() as unknown as MidiEvent[];
    // Removed targetNote

    let hasNoteOn = false;

    // Process MIDI stream
    for (const event of stream) {
      if (event.type === 'note_on') {
        // Trigger on ANY note
        state.lastActive = true;
        state.lastActiveNote = event.note;
        state.activeVelocity = event.velocity;
        hasNoteOn = true;
      } else if (event.type === 'note_off') {
        // Release only if matching
        if (state.lastActiveNote === event.note) {
          state.lastActive = false;
          state.lastActiveNote = null;
        }
      }
    }

    const syntheticStep: Step = {
      noteIndex: state.lastActive ? state.lastActiveNote : null,
      velocity: state.activeVelocity,
      hold: false,
    };

    // Use the provided audio context from execution context
    if (!activeLayer.audioContext) {
      if (context.audio?.context) {
        activeLayer.audioContext = context.audio.context;
      } else if (typeof window !== 'undefined') {
        activeLayer.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    }

    activeLayer.update(syntheticStep, context.clock.dt, hasNoteOn);
    const result = activeLayer.getValue();

    return { out: result };
  },
  compileConfig: (uiConfig) => ({}),
});

registerNode(toneSynthLayer);
