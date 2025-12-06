import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { MidiEvent } from "../../io/midi/types";

// Helper to parse MIDI status
const getStatusType = (status: number) => status & 0xF0;
const getChannel = (status: number) => (status & 0x0F) + 1;

// --- UI Field Definitions ---

const MidiInputFields: InspectorFieldDef[] = [
  { type: 'string', label: 'Device ID', path: 'deviceId', placeholder: 'Optional Device ID' }
];

const MidiCcInputFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Channel', path: 'channel', min: 1, max: 16, step: 1 },
  { type: 'number', label: 'CC', path: 'cc', min: 0, max: 127, step: 1 },
  { type: 'string', label: 'Device ID', path: 'deviceId', placeholder: 'Optional Device ID' }
];

const MidiCcFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Channel', path: 'channel', min: 1, max: 16, step: 1 },
  { type: 'number', label: 'CC', path: 'cc', min: 0, max: 127, step: 1 }
];

const MidiNoteFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Channel', path: 'channel', min: 1, max: 16, step: 1 },
  { type: 'number', label: 'Note', path: 'note', min: 0, max: 127, step: 1 }
];

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

export const midiInputNode = defineNode({
  id: "midi.input",
  version: "1.0.0",
  displayName: "MIDI Input",
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
  ui: { inspector: { fields: MidiInputFields } },
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
  },
  compileConfig: (uiConfig) => ({
    fields: { deviceId: uiConfig.deviceId },
    untagged: []
  }),
});

export const midiCcInputNode = defineNode({
  id: "midi.cc.input",
  version: "1.0.0",
  displayName: "MIDI CC Input",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'cc', 'input'],
    description: 'Reads a MIDI CC value directly from the environment.'
  },
  inputs: {},
  config: {
    channel: numberType,
    cc: numberType,
    deviceId: { kind: 'atomic', type: 'string', optional: true }
  },
  outputs: {
    value: numberType
  },
  ui: { inspector: { fields: MidiCcInputFields } },
  isRealtime: () => true,
  execute: (inputs, config, context) => {
    const channel = (config.channel as number) || 1;
    const cc = (config.cc as number) || 0;
    const deviceId = config.deviceId as string;

    const key = `${channel}:${cc}`;
    const value = context.midi?.values.get(key) ?? 0;

    return { value };
  },
  compileConfig: (uiConfig) => ({
    fields: { channel: uiConfig.channel ?? 1, cc: uiConfig.cc ?? 0, deviceId: uiConfig.deviceId },
    untagged: []
  }),
});


export const midiCcNode = defineNode({
  id: "midi.cc",
  version: "1.0.0",
  displayName: "MIDI CC",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'cc', 'control change'],
    description: 'Reads MIDI Control Change messages from a stream.'
  },
  inputs: {
    stream: midiStreamType
  },
  config: {
    channel: numberType,
    cc: numberType,
  },
  outputs: {
    value: numberType
  },
  ui: { inspector: { fields: MidiCcFields } },
  createState: () => ({ value: 0 }),
  execute: (inputs, config, context, state) => {
    const channel = (config.channel as number) || 1;
    const targetCc = (config.cc as number) || 0;

    const stream = inputs.stream as unknown as MidiEvent[];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.type === 'cc' && event.channel === channel && event.cc === targetCc) {
          state.value = event.value / 127.0;
        }
      }
    }

    return { value: state.value };
  },
  compileConfig: (uiConfig) => ({
    fields: { channel: uiConfig.channel ?? 1, cc: uiConfig.cc ?? 0, deviceId: uiConfig.deviceId },
    untagged: []
  }),
});

export const midiNoteNode = defineNode({
  id: "midi.note",
  version: "1.0.0",
  displayName: "MIDI Note",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'note', 'keyboard'],
    description: 'Reads MIDI Note messages from a stream.'
  },
  inputs: {
    stream: midiStreamType
  },
  config: {
    channel: numberType,
    note: numberType, // Optional: if 0 or undefined, maybe listen to all? For now, let's stick to specific note.
  },
  outputs: {
    note: { kind: 'atomic', type: 'number', optional: true },
    velocity: numberType,
    gate: numberType
  },
  ui: { inspector: { fields: MidiNoteFields } },
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
  },
  compileConfig: (uiConfig) => ({
    fields: { channel: uiConfig.channel ?? 1, note: uiConfig.note ?? 60, deviceId: uiConfig.deviceId },
    untagged: []
  }),
});

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
    stream: midiStreamType
  },
  config: {
    channel: numberType,
    rootNote: numberType, // Anchor note (default 60 for Middle C)
    priority: { kind: 'atomic', type: 'string', optional: true } // 'last', 'low', 'high'
  },
  outputs: {
    note: { kind: 'atomic', type: 'number', optional: true },
    velocity: numberType,
    gate: numberType,
    frequency: numberType
  },
  ui: { inspector: { fields: MidiToMonoFields } },
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
  },
  compileConfig: (uiConfig) => ({
    fields: { channel: uiConfig.channel ?? 1, rootNote: uiConfig.rootNote ?? 60, priority: uiConfig.priority ?? 'last' },
    untagged: []
  }),
});

registerNode(midiInputNode);
registerNode(midiCcInputNode);
registerNode(midiCcNode);
registerNode(midiNoteNode);
registerNode(midiToMonoNode);

export const midiFilterNode = defineNode({
  id: "midi.filter",
  version: "1.0.0",
  displayName: "MIDI Filter",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'filter', 'note'],
    description: 'Filters MIDI events, allowing only specific Note On/Off messages through.'
  },
  inputs: {
    stream: midiStreamType,
    channel: { type: numberType, description: 'MIDI Channel (1-16)', defaultValue: 1 },
    note: { type: numberType, description: 'Note Number (0-127)', defaultValue: 60 }
  },
  config: {}, // Removed config params
  outputs: {
    stream: midiStreamType
  },
  ui: { inspector: { fields: MidiNoteFields } }, // Reuse MidiNoteFields (Channel, Note)
  execute: (inputs, config, context) => {
    const channel = (inputs.channel as number) ?? 1;
    const targetNote = (inputs.note as number) ?? 60;
    const stream = inputs.stream as unknown as MidiEvent[];

    const filteredStream: MidiEvent[] = [];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.channel === channel) {
          if (event.type === 'note_on' || event.type === 'note_off') {
            if (event.note === targetNote) {
              filteredStream.push(event);
            }
          } else {
             // Block non-note events for strict filtering consistency
          }
        }
      }
    }

    return { stream: filteredStream };
  },
  compileConfig: (uiConfig) => ({
    fields: {},
    values: { channel: uiConfig.channel ?? 1, note: uiConfig.note ?? 60 },
    untagged: []
  }),
});


export const midiPitchNode = defineNode({
  id: "midi.pitch",
  version: "1.0.0",
  displayName: "MIDI Pitch",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'pitch', 'transpose', 'shift'],
    description: 'Transposes MIDI Note events by a specified amount.'
  },
  inputs: {
    stream: midiStreamType,
    pitch: { type: numberType, description: 'Pitch shift amount (semitones)', defaultValue: 0, range: [ -24, 24 ] }
  },
  config: {},
  outputs: {
    stream: midiStreamType
  },
  execute: (inputs, config, context) => {
    // Only use inputs.pitch. If unconnected, GraphExecutor injects defaultValue OR virtual input from config.values
    const shift = (inputs.pitch ?? 0) as number;
    const stream = inputs.stream as unknown as MidiEvent[];

    if (!stream || !Array.isArray(stream)) return { stream: [] };

    const processedStream: MidiEvent[] = stream.map(event => {
      if (event.type === 'note_on' || event.type === 'note_off') {
        const newNote = Math.max(0, Math.min(127, Math.floor(event.note + shift)));
        return { ...event, note: newNote };
      }
      return event;
    });

    return { stream: processedStream };
  },
  compileConfig: (uiConfig) => ({
    fields: {},
    values: { pitch: uiConfig.pitch ?? 0 }, // Virtual Input
    untagged: []
  }),
});

registerNode(midiPitchNode);
