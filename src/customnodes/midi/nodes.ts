import { definePrimitiveNode, NumberType } from "../../structor/type-helpers";
import { NodeCategory } from "../../structor/structor";

// We need a way to access MIDI state in the worker.
// We'll export a singleton `midiState` here that the worker can update.
export const workerMidiState = {
  activeNotes: new Map<string, number>(), // key: "channel:note", value: velocity
  ccValues: new Map<string, number>(), // key: "channel:cc", value: value
  // We simplify device handling for the worker:
  // The main thread filters by device if needed, or we pass deviceId in the key.
  // The user said: "If no device is selected, mapped paths will match _all_ devices."
  // So the worker just needs to know the values.
  // Let's use keys like "deviceId:channel:target" and also "channel:target" (merged).
  // Actually, if we merge in the main thread, it's easier.
  // But the node config might specify a deviceId.
  // So we should store "deviceId:channel:target".
  // And also maybe a "all:channel:target" map?
  // Or just iterate? Maps are fast.

  values: new Map<string, number>() // key: "deviceId:channel:target" (target is cc or note)
};

export const midiCcNode = definePrimitiveNode({
  id: "io.midi.cc",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'cc', 'control change'],
    description: 'Reads MIDI Control Change messages.'
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
  execute: (inputs, config, context) => {
    const channel = (config.channel as number) || 1;
    const cc = (config.cc as number) || 0;
    const deviceId = config.deviceId as string | undefined;

    // Construct key
    // If deviceId is present, look for specific device.
    // If not, we need a way to find "any" device.
    // Since we don't have a "merged" map, we might need to iterate or the main thread sends a merged update.
    // Let's assume the main thread sends updates with a special deviceId "*" for merged events?
    // Or we just look up "*" if deviceId is missing.

    const key = `${deviceId || '*'}:${channel}:${cc}`;
    const value = workerMidiState.values.get(key) ?? 0;

    // Normalize 0-127 to 0-1?
    // User said: "new input value". Usually 0-1 is better for synthesis.
    // Let's output 0-1.
    return { value: value / 127.0 };
  }
});

export const midiNoteNode = definePrimitiveNode({
  id: "io.midi.note",
  metadata: {
    category: NodeCategory.IO,
    keywords: ['midi', 'note', 'keyboard'],
    description: 'Reads MIDI Note messages.'
  },
  inputs: {},
  config: {
    channel: NumberType,
    note: NumberType,
    deviceId: { kind: 'atomic', type: 'string', optional: true }
  },
  outputs: {
    note: { kind: 'atomic', type: 'number', optional: true }, // Nullable
    velocity: NumberType,
    gate: NumberType // 0 or 1
  },
  execute: (inputs, config, context) => {
    const channel = (config.channel as number) || 1;
    const note = (config.note as number) || 60;
    const deviceId = config.deviceId as string | undefined;

    const key = `${deviceId || '*'}:${channel}:${note}`;
    const velocity = workerMidiState.values.get(key) ?? 0;

    const isNoteOn = velocity > 0;

    return {
      note: isNoteOn ? note : null,
      velocity: velocity / 127.0,
      gate: isNoteOn ? 1 : 0
    };
  }
});
