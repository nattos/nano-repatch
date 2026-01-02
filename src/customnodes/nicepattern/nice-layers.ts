import { defineNode, registerNode } from "../../structor/node-helpers";
import { midiStreamType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";
import { Step } from "./envelope-generator";
import {
  GateLayer,
  ExponentialLayer,
  PWMLayer,
  NoiseLayer,
} from "./layers";
import { AbstractLayer, LayerConfig } from "./abstract-layer";
import { layerOutputStructorType } from "./nice-types";

interface LayerState {
  layer: AbstractLayer;
  lastActive: boolean;
  activeVelocity: number;
  activeNote: number | null;
}

export function createLayerNode(
  id: string,
  displayName: string,
  LayerClass: new (config: LayerConfig) => AbstractLayer
) {
  return defineNode({
    id,
    version: "1.0.0",
    displayName,
    metadata: {
      category: 'NicePattern',
      keywords: ['layer', 'effect', 'modifier'],
      description: `Layer node: ${displayName}`
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
    ui: { inspector: { fields: [] } }, // Removed LayerFields (targetNote)
    isRealtime: () => true,
    createState: (config, context): LayerState => {
      return {
        layer: new LayerClass({}),
        lastActive: false,
        activeVelocity: 0,
        activeNote: null as number | null
      };
    },
    execute: (inputs, config, context, state) => {
      const activeLayer = state.layer as AbstractLayer;
      // Flattening handled by autoBroadcast.midi_in.combine.reduce = 'flatten'
      const stream = (inputs.midi_in || []) as MidiEvent[];

      // Process MIDI stream
      for (const event of stream) {
        if (event.type === 'note_on') {
          // Trigger on ANY note, track it as active
          state.lastActive = true;
          state.activeVelocity = event.velocity;
          state.activeNote = event.note;
        } else if (event.type === 'note_off') {
          // Only release if the Off event matches our current active note
          if (state.activeNote === event.note) {
            state.lastActive = false;
            state.activeNote = null;
          }
        }
      }

      const syntheticStep: Step = {
        noteIndex: state.lastActive ? (state.activeNote ?? 60) : null,
        velocity: state.activeVelocity,
        hold: false, // We don't easily track hold from stream without more state
      };

      // We assume isNewStep is true if we processed any relevant events?
      // Or we rely on the layer's internal logic.
      // The original code passed 'isNewStep' if the event object changed reference.
      // Here, we should probably pass true if we received a Note On.
      const hasNoteOn = stream.some((e: MidiEvent) => e.type === 'note_on');

      activeLayer.update(syntheticStep, context.clock.dt, hasNoteOn);
      const result = activeLayer.getValue();

      return { out: result };
    },
    compileConfig: (uiConfig) => ({}),
  });
}

export const gateLayer = createLayerNode("nicepattern.gate_layer", "Gate Layer", GateLayer);
export const expLayer = createLayerNode("nicepattern.exp_layer", "Exponential Layer", ExponentialLayer);
export const pwmLayer = createLayerNode("nicepattern.pwm_layer", "PWM Layer", PWMLayer);
export const noiseLayer = createLayerNode("nicepattern.noise_layer", "Noise Layer", NoiseLayer);

registerNode(gateLayer);
registerNode(expLayer);
registerNode(pwmLayer);
registerNode(noiseLayer);
