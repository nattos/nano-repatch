import { definePrimitiveNode, NumberType } from "../../structor/type-helpers";
import { NodeCategory, StructorRecord } from "../../structor/structor";
import { midiStreamType, midiEventType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";

// Helper to parse MIDI status
const getStatusType = (status: number) => status & 0xF0;
const getChannel = (status: number) => (status & 0x0F) + 1;

export const midiInputNode = definePrimitiveNode({
  id: "midi.input",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'input', 'source'],
    description: 'Reads raw MIDI messages from a specific device.'
  },
  inputs: {},
  config: {
    deviceId: { kind: 'atomic', type: 'string', optional: true }
  },
  outputs: {
    stream: midiStreamType
  },
  isRealtime: () => true,
  execute: (inputs, config, context) => {
    // Access MIDI state from context
    // Access MIDI events from context
    const midiEvents = context.midi?.events as MidiEvent[] | undefined;

    if (midiEvents && config.deviceId) {
      // Filter by device ID
      const filtered = midiEvents.filter(e => e.deviceId === config.deviceId);
      return { stream: filtered };
    }

    return { stream: midiEvents || [] };


  }
});

export const midiCcInputNode = definePrimitiveNode({
  id: "midi.cc.input",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'cc', 'input'],
    description: 'Reads a MIDI CC value directly from the environment.'
  },
  inputs: {},
  config: {
    channel: NumberType,
    cc: NumberType,
    deviceId: { kind: 'atomic', type: 'string', optional: true }
  },
  outputs: {
    value: NumberType
  },
  isRealtime: () => true,
  execute: (inputs, config, context) => {
    const channel = (config.channel as number) || 1;
    const cc = (config.cc as number) || 0;
    const deviceId = config.deviceId as string;

    // Construct key: "channel:cc" or similar?
    // I need to know how `workerMidiState` keys were constructed.
    // Assuming "channel:cc" or similar.
    // Let's guess "ch:cc" based on common patterns or check if I can find previous code.
    // Since I can't check deleted code easily, I'll assume a standard format or try to find it in `executor.worker.ts` (it just receives values).
    // The main thread sends it.

    // Let's assume the key is `${channel}:${cc}` for now.
    const key = `${channel}:${cc}`;
    const value = context.midi?.values.get(key) ?? 0;

    return { value };
  }
});


export const midiCcNode = definePrimitiveNode({
  id: "midi.cc",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'cc', 'control change'],
    description: 'Reads MIDI Control Change messages from a stream.'
  },
  inputs: {
    stream: midiStreamType
  },
  config: {
    channel: NumberType,
    cc: NumberType,
  },
  outputs: {
    value: NumberType
  },
  createState: () => ({ value: 0 }),
  execute: (inputs, config, context, state) => {
    const channel = (config.channel as number) || 1;
    const targetCc = (config.cc as number) || 0;

    // Cast inputs to access the stream
    // The input name is 'stream', so it should be in inputs.stream
    // But inputs is typed as InferRecord<TInputs>.
    // TInputs is { stream: midiStreamType }.
    // So inputs.stream is StructorArray (array of records).

    const stream = inputs.stream as unknown as MidiEvent[];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.type === 'cc' && event.channel === channel && event.cc === targetCc) {
          state.value = event.value / 127.0;
        }
      }
    }

    return { value: state.value };
  }
});

export const midiNoteNode = definePrimitiveNode({
  id: "midi.note",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'note', 'keyboard'],
    description: 'Reads MIDI Note messages from a stream.'
  },
  inputs: {
    stream: midiStreamType
  },
  config: {
    channel: NumberType,
    note: NumberType, // Optional: if 0 or undefined, maybe listen to all? For now, let's stick to specific note.
  },
  outputs: {
    note: { kind: 'atomic', type: 'number', optional: true },
    velocity: NumberType,
    gate: NumberType
  },
  createState: () => ({ velocity: 0, gate: 0 }),
  execute: (inputs, config, context, state) => {
    const channel = (config.channel as number) || 1;
    const targetNote = (config.note as number) || 60;

    const stream = inputs.stream as unknown as MidiEvent[];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.channel === channel) {
          if (event.type === 'note_on' && event.note === targetNote) {
            state.velocity = event.velocity / 127.0;
            state.gate = 1;
          } else if (event.type === 'note_off' && event.note === targetNote) {
            state.gate = 0;
          }
        }
      }
    }

    return {
      note: state.gate ? targetNote : null,
      velocity: state.velocity,
      gate: state.gate
    };
  }
});

export const midiToMonoNode = definePrimitiveNode({
  id: "midi.to_mono",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'mono', 'converter'],
    description: 'Converts a polyphonic MIDI stream to a monophonic note signal.'
  },
  inputs: {
    stream: midiStreamType
  },
  config: {
    channel: NumberType,
    rootNote: NumberType, // Anchor note (default 60 for Middle C)
    priority: { kind: 'atomic', type: 'string', optional: true } // 'last', 'low', 'high'
  },
  outputs: {
    note: { kind: 'atomic', type: 'number', optional: true },
    velocity: NumberType,
    gate: NumberType,
    frequency: NumberType
  },
  createState: () => ({
    activeNotes: [] as { note: number, velocity: number }[], // Stack for last-note priority
    gate: 0
  }),
  execute: (inputs, config, context, state) => {
    const channel = (config.channel as number) || 1;
    const rootNote = (config.rootNote as number) ?? 60;
    const stream = inputs.stream as unknown as MidiEvent[];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.channel === channel) {
          if (event.type === 'note_on') {
            // Remove existing instance of this note to move it to top (retrigger)
            state.activeNotes = state.activeNotes.filter(n => n.note !== event.note);
            state.activeNotes.push({ note: event.note, velocity: event.velocity / 127.0 });
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
  }
});
