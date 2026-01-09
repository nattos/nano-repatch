import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { NumberType } from "../../structor/type-helpers";
import { MidiEvent } from "../../io/midi/types";

interface MidiStreamInput {
  stream: MidiEvent[];
}
interface MidiToMonoInputs extends MidiStreamInput { }

const MidiToMonoFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Channel', path: 'channel', min: 1, max: 16, step: 1 },
  { type: 'number', label: 'Root Note', path: 'rootNote', min: 0, max: 127, step: 1 },
  {
    type: 'select', label: 'Priority', path: 'priority', options: [
      { label: 'Last Note', value: 'last' },
      { label: 'Low Note', value: 'low' },
      { label: 'High Note', value: 'high' }
    ]
  }
];

// strict type inference
export const midiToMonoNode = defineNode({
  id: "midi.to_mono",
  version: "1.0.0",
  displayName: "MIDI to Mono",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'mono', 'converter'],
    description: 'Converts a polyphonic MIDI stream to a monophonic note signal.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  config: {
    channel: numberType,
    rootNote: numberType,
    priority: { kind: 'atomic', type: 'string', optional: true }
  },
  outputs: {
    note: { kind: 'atomic', type: 'number', optional: true },
    velocity: numberType,
    gate: numberType,
    frequency: numberType
  },
  ui: { inspector: { fields: MidiToMonoFields } },
  createState: (): { activeNotes: { note: number, velocity: number }[], gate: number } => ({
    activeNotes: [],
    gate: 0
  }),
  execute: (inputs, config, context, state) => {
    // Inputs are strictly typed
    const channel = config.channel || 1;
    const rootNote = config.rootNote ?? 60;
    const stream = (inputs.stream || []) as MidiEvent[];

    if (!state.activeNotes) {
      state.activeNotes = [];
    }

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.channel === channel) {
          if (event.type === 'note_on') {
            // Remove existing instance of this note to move it to top (retrigger)
            state.activeNotes = state.activeNotes.filter(n => n.note !== event.note);
            state.activeNotes.push({ note: event.note!, velocity: (event.velocity ?? 0) });
          } else if (event.type === 'note_off') {
            state.activeNotes = state.activeNotes.filter(n => n.note !== event.note);
          }
        }
      }
    }

    const activeNote = state.activeNotes.length > 0 ? state.activeNotes[state.activeNotes.length - 1] : null;

    if (activeNote) {
      state.gate = 1;
      const relativeNote = activeNote.note - rootNote;
      // Simple frequency calculation: 440 * 2^((note - 69) / 12)
      const frequency = 440 * Math.pow(2, (activeNote.note - 69) / 12);

      return {
        note: relativeNote,
        velocity: activeNote.velocity,
        gate: 1,
        frequency: frequency
      };
    } else {
      state.gate = 0;
      return {
        note: null,
        velocity: 0,
        gate: 0,
        frequency: 0
      };
    }
  },
  compileConfig: (uiConfig: { channel?: number, rootNote?: number, priority?: string }) => ({
    channel: uiConfig.channel ?? 1,
    rootNote: uiConfig.rootNote ?? 60,
    priority: uiConfig.priority ?? 'last'
  }),
});

registerNode(midiToMonoNode);
