import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { NodeCategory } from "../../structor/structor";
import { midiStreamType, numberType } from "../../structor/std-types";
import { StringType, NumberType, AnyType } from "../../structor/type-helpers";
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

// --- Node Definitions ---

export const midiInputNode = defineNode<any, { deviceId?: string }, { deviceId: { kind: 'atomic', type: 'string', optional?: boolean, defaultValue?: string } }>({
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
    const midiEvents = context.midi?.events as MidiEvent[] | undefined;
    const deviceId = config.deviceId;

    if (midiEvents && deviceId) {
      // Filter by device ID
      const filtered = midiEvents.filter(e => e.deviceId === deviceId);
      return { stream: filtered };
    }

    return { stream: midiEvents || [] };
  },
  compileConfig: (uiConfig) => ({
    deviceId: uiConfig.deviceId
  }),
});

export const midiCcInputNode = defineNode<any, { channel?: number, cc?: number, deviceId?: string }, { channel: typeof NumberType, cc: typeof NumberType, deviceId: { kind: 'atomic', type: 'string', optional?: boolean } }>({
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
    const channel = config.channel || 1;
    const cc = config.cc || 0;
    const deviceId = config.deviceId;

    const key = `${channel}:${cc}`;
    const value = context.midi?.values.get(key) ?? 0;

    return { value };
  },
  compileConfig: (uiConfig) => ({
    channel: uiConfig.channel ?? 1,
    cc: uiConfig.cc ?? 0,
    deviceId: uiConfig.deviceId
  }),
});


export const midiCcNode = defineNode<any, { channel?: number, cc?: number }, { channel: typeof NumberType, cc: typeof NumberType }, any, { value: number }>({
  id: "midi.cc",
  version: "1.0.0",
  displayName: "MIDI CC",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'cc', 'control change'],
    description: 'Reads MIDI Control Change messages from a stream.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
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
    const channel = config.channel || 1;
    const targetCc = config.cc || 0;

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
    channel: uiConfig.channel ?? 1,
    cc: uiConfig.cc ?? 0
  }),
});

export const midiNoteNode = defineNode<any, { channel?: number, note?: number }, { channel: typeof NumberType, note: typeof NumberType }, any, { velocity: number, gate: number }>({
  id: "midi.note",
  version: "1.0.0",
  displayName: "MIDI Note",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'note', 'keyboard'],
    description: 'Reads MIDI Note messages from a stream.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  config: {
    channel: numberType,
    note: numberType,
  },
  outputs: {
    note: { kind: 'atomic', type: 'number', optional: true },
    velocity: numberType,
    gate: numberType
  },
  ui: { inspector: { fields: MidiNoteFields } },
  createState: () => ({ velocity: 0, gate: 0 }),
  execute: (inputs, config, context, state) => {
    const channel = config.channel || 1;
    const targetNote = config.note || 60;

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
    channel: uiConfig.channel ?? 1,
    note: uiConfig.note ?? 60
  }),
});

export const midiToMonoNode = defineNode<any, { channel?: number, rootNote?: number, priority?: string }, { channel: typeof NumberType, rootNote: typeof NumberType, priority: { kind: 'atomic', type: 'string', optional?: boolean } }, any, { activeNotes: { note: number, velocity: number }[], gate: number }>({
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
  createState: () => ({
    activeNotes: [],
    gate: 0
  }),
  execute: (inputs, config, context, state) => {
    const channel = config.channel || 1;
    const rootNote = config.rootNote ?? 60;
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
    channel: uiConfig.channel ?? 1,
    rootNote: uiConfig.rootNote ?? 60,
    priority: uiConfig.priority ?? 'last'
  }),
});

// midi.filter: uses inputs, config is empty
export const midiFilterNode = defineNode<any, { channel?: number, note?: number }, {}>({
  id: "midi.filter",
  version: "1.0.0",
  displayName: "MIDI Filter",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'filter', 'note'],
    description: 'Filters MIDI events, allowing only specific Note On/Off messages through.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true },
    channel: { type: numberType, description: 'MIDI Channel (1-16)', defaultValue: 1 },
    note: { type: numberType, description: 'Note Number (0-127)', defaultValue: 60 }
  },
  config: {},
  outputs: {
    stream: midiStreamType
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  ui: { inspector: { fields: MidiNoteFields } }, // Reuse MidiNoteFields
  execute: (inputs: any, config: any) => {
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
          }
        }
      }
    }

    return { stream: filteredStream };
  },
  compileConfig: (uiConfig) => ({
    // Return values for Virtual Inputs
    channel: uiConfig.channel ?? 1,
    note: uiConfig.note ?? 60
  }),
});

// midi.pitch: uses inputs, config is empty
export const midiPitchNode = defineNode<any, { pitch?: number }, {}>({
  id: "midi.pitch",
  version: "1.0.0",
  displayName: "MIDI Pitch",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'pitch', 'transpose', 'shift'],
    description: 'Transposes MIDI Note events by a specified amount.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true },
    pitch: { type: numberType, description: 'Pitch shift amount (semitones)', defaultValue: 0, range: [-24, 24] }
  },
  config: {},
  outputs: {
    stream: midiStreamType
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  execute: (inputs: any, config) => {
    // Inputs drove by generic Logic
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
    pitch: uiConfig.pitch ?? 0
  }),
});


// --- Generic Trigger/MIDI Nodes ---

export const midiTriggerNode = defineNode<any, { pitch?: number, velocity?: number, trigger?: number }, { pitch: { kind: 'atomic', type: 'number', defaultValue?: number }, velocity: { kind: 'atomic', type: 'number', defaultValue?: number, range?: number[] }, trigger: typeof NumberType }, any, { lastTrigger: number, isNoteOn: boolean, time: number }>({
  id: "midi.trigger",
  version: "1.0.0",
  displayName: "MIDI Trigger",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'trigger', 'bang', 'button'],
    description: 'Manually sends a Middle C Note On/Off pair when triggered.'
  },
  inputs: {
    trigger: { type: numberType, description: 'Trigger Signal', suppressInputEditor: true }
  },
  config: {
    pitch: { ...numberType, defaultValue: 60 },
    velocity: { ...numberType, defaultValue: 1.0, range: [0, 1] },
    trigger: numberType
  },
  outputs: {
    stream: midiStreamType
  },
  isRealtime: () => true,
  createState: () => ({ lastTrigger: 0, isNoteOn: false, time: 0 }),
  execute: (inputs, config, context, state) => {
    const pitch = config.pitch || 60;
    const velocity = config.velocity || 1.0;
    const trigger = inputs.trigger || 0;
    const dt = context.clock.dt;
    if (context.nodeId === 't1' || context.nodeId === 't2') {
      console.log(`[TRIGGER DEBUG] ${context.nodeId} trigger=${trigger} last=${state.lastTrigger} on=${state.isNoteOn} time=${state.time} dt=${dt}`);
    }

    const stream: MidiEvent[] = [];

    // Logic: Pulse / Trigger
    // Rising Edge -> Note On + Start Timer (0.1s default duration)
    // Timer Expire -> Note Off
    // Falling Edge -> Note Off (Early release)

    if (trigger > state.lastTrigger) {
      // Rising Edge
      if (state.isNoteOn) {
        // Retrigger (kill old)
        stream.push({ type: 'note_off', channel: 1, note: pitch, velocity: 0, deviceId: 'virtual' } as MidiEvent);
      }
      // Start new
      stream.push({ type: 'note_on', channel: 1, note: pitch, velocity: Math.floor(velocity * 127), deviceId: 'virtual' } as MidiEvent);
      state.isNoteOn = true;
      state.time = 0.1; // 100ms duration
    } else if (trigger < state.lastTrigger) {
      // Falling Edge (Early Release)
      if (state.isNoteOn) {
        stream.push({ type: 'note_off', channel: 1, note: pitch, velocity: 0, deviceId: 'virtual' } as MidiEvent);
        state.isNoteOn = false;
        state.time = 0;
      }
    } else if (state.isNoteOn && state.time > 0) {
      // Sustaining
      state.time -= dt;
      if (state.time <= 0) {
        // Auto Release
        stream.push({ type: 'note_off', channel: 1, note: pitch, velocity: 0, deviceId: 'virtual' } as MidiEvent);
        state.isNoteOn = false;
      }
    }

    state.lastTrigger = trigger;

    return { stream };
  },
  compileConfig: (uiConfig) => ({
    pitch: uiConfig.pitch ?? 60,
    velocity: uiConfig.velocity ?? 1.0,
    trigger: uiConfig.trigger
  }),
  ui: {
    inspector: {
      fields: [
        { type: 'button', label: 'Trigger', path: 'trigger', text: 'Bang' },
        { type: 'number', label: 'Pitch', path: 'pitch', min: 0, max: 127, step: 1, default: 60 },
        { type: 'number', label: 'Velocity', path: 'velocity', min: 0, max: 1, step: 0.01, default: 1.0 }
      ]
    }
  }
});

export const midiMergeNode = defineNode({
  id: "midi.merge",
  version: "1.0.0",
  displayName: "MIDI Merge",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'merge', 'combine', 'mix'],
    description: 'Merges multiple MIDI streams into one using auto-broadcast.'
  },
  inputs: {
    stream: { type: midiStreamType, description: 'Input Streams', allowMultiConnection: true }
  },
  outputs: {
    stream: midiStreamType
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  config: {},
  execute: (inputs, config, context) => {
    return { stream: inputs.stream as unknown as MidiEvent[] };
  },
  compileConfig: () => ({})
});

export const midiSelectNode = defineNode<any, { count?: number, root?: number, skip?: number }, { count: typeof NumberType, root: typeof NumberType, skip: typeof NumberType }>({
  id: "midi.select",
  version: "1.0.0",
  displayName: "MIDI Select",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'select', 'router', 'switch', 'demux'],
    description: 'Routes MIDI events to different ports based on note pitch.'
  },
  inputs: {
    stream: { type: midiStreamType, allowMultiConnection: true }
  },
  autoBroadcast: {
    stream: { combine: { reduce: 'flatten' } }
  },
  config: {
    count: { ...numberType, defaultValue: 4 },
    root: { ...numberType, defaultValue: 60 },
    skip: { ...numberType, defaultValue: 1 }
  },
  outputs: {},
  dynamicOutputType: midiStreamType,
  isRealtime: () => true,
  computeForwardPorts: (inputTypes, uiConfig, context) => {
    const count = (uiConfig.count as number) || 4;
    const outputs: any = {};

    for (let i = 0; i < count; i++) {
      outputs[i.toString()] = { ...midiStreamType, hint: 'midi-stream', description: `Offset ${i}` };
    }
    outputs['rem'] = { ...midiStreamType, hint: 'midi-stream', description: 'Remainder' };

    return {
      inputs: { kind: 'record', fields: { stream: midiStreamType } },
      outputs: { kind: 'record', fields: outputs }
    };
  },
  shouldRecompileOnConfigChange: (uiConfig) => {
    return true;
  },
  execute: (inputs, config, context) => {
    const stream = inputs.stream as unknown as MidiEvent[];
    const count = config.count || 4;
    const root = config.root || 60;
    const skip = config.skip || 1;

    const results: Record<string, MidiEvent[]> = {};
    for (let i = 0; i < count; i++) {
      results[i.toString()] = [];
    }
    results['rem'] = [];

    if (stream && Array.isArray(stream)) {
      for (const event of stream) {
        if (event.type === 'note_on' || event.type === 'note_off') {
          const diff = event.note - root;
          if (diff >= 0 && (diff % skip) === 0) {
            const index = diff / skip;
            if (index >= 0 && index < count) {
              results[index.toString()].push(event);
              continue;
            }
          }
          results['rem'].push(event);
        } else {
          // Ignore non-note events
        }
      }
    }

    return { ...results };
  },
  compileConfig: (uiConfig) => ({
    count: uiConfig.count ?? 4,
    root: uiConfig.root ?? 60,
    skip: uiConfig.skip ?? 1
  }),
  ui: {
    inspector: {
      fields: [
        { type: 'number', label: 'Output Count', path: 'count', min: 1, max: 128, step: 1, default: 4 },
        { type: 'number', label: 'Root Note', path: 'root', min: 0, max: 127, step: 1, default: 60 },
        { type: 'number', label: 'Skip (Semitones)', path: 'skip', min: 1, max: 24, step: 1, default: 1 }
      ]
    }
  }
});

registerNode(midiInputNode);
registerNode(midiCcInputNode);
registerNode(midiCcNode);
registerNode(midiNoteNode);
registerNode(midiToMonoNode);
registerNode(midiFilterNode);
registerNode(midiPitchNode);
registerNode(midiTriggerNode);
registerNode(midiMergeNode);
registerNode(midiSelectNode);
