
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { timeNode, beatNode } from './time-nodes';
import { midiMetronomeNode } from '../midi/midi-metronome';
import { GraphDefinition } from '../../structor/structor';
import { midiStreamType, numberType } from '../../structor/std-types';

describe('Time and Metronome Integration', () => {
  const repository = new NodeRepository();

  // Register nodes under test
  repository.register({
    id: 'time.time',
    version: '1.0.0',
    displayName: 'Time',
    definition: timeNode,
    inputs: [],
    outputs: []
  });
  repository.register({
    id: 'time.beat',
    version: '1.0.0',
    displayName: 'Beat',
    definition: beatNode,
    inputs: [],
    outputs: []
  });
  repository.register({
    id: 'midi.metronome',
    version: '1.0.0',
    displayName: 'Metronome',
    definition: midiMetronomeNode,
    inputs: [{ name: 'duration', type: numberType }],
    outputs: [{ name: 'stream', type: midiStreamType }] // Ensure output def matches
  });

  const createGraph = (nodeId: string, definitionId: string, config: any): GraphDefinition => ({
    id: 'test-graph',
    kind: 'graph',
    type: { kind: 'graph', inputs: { kind: 'record', fields: {}, }, outputs: { kind: 'record', fields: {}, } },
    nodes: {
      [nodeId]: { definitionId, defaultConfig: config }
    },
    connections: [],
    inputs: {},
    outputs: {},
    executionOrder: [nodeId]
  });

  it('time.time should output execution context time', () => {
    const graph = createGraph('timeNode', 'time.time', {});
    graph.outputs = {
      'time': { nodeId: 'timeNode', port: 'time' },
      'delta': { nodeId: 'timeNode', port: 'delta' }
    };

    const executor = new GraphExecutor(graph, repository);

    // Tick 1: Time 10s, DT 0.1s
    executor.update({ time: 10, clock: { beat: 0, dt: 0.1 } });
    expect(executor.getGraphOutput('time')).toBe(10);
    expect(executor.getGraphOutput('delta')).toBe(0.1);

    // Tick 2: Time 10.1s, DT 0.1s
    executor.update({ time: 10.1, clock: { beat: 1, dt: 0.1 } });
    expect(executor.getGraphOutput('time')).toBe(10.1);
    expect(executor.getGraphOutput('delta')).toBe(0.1);
  });

  it('time.beat should output execution context beat and calculated delta', () => {
    const graph = createGraph('beatNode', 'time.beat', {});
    graph.outputs = {
      'beat': { nodeId: 'beatNode', port: 'beat' },
      'delta': { nodeId: 'beatNode', port: 'delta' }
    };

    const executor = new GraphExecutor(graph, repository);

    // Tick 1: Beat 0
    executor.update({ time: 0, clock: { beat: 0, dt: 0.1 } });
    expect(executor.getGraphOutput('beat')).toBe(0);
    // First tick delta might be 0 or slightly weird depending on init state, let's see.
    // State initialized to -1. 0 - (-1) = 1? No, 0 - (-1) = 1.
    expect(executor.getGraphOutput('delta')).toBe(0); // Initial delta is 0

    // Tick 2: Beat 1
    executor.update({ time: 0.5, clock: { beat: 1, dt: 0.1 } });
    expect(executor.getGraphOutput('beat')).toBe(1);
    expect(executor.getGraphOutput('delta')).toBe(1); // 1 - 0 = 1

    // Tick 3: Beat 1.5
    executor.update({ time: 0.75, clock: { beat: 1.5, dt: 0.1 } });
    expect(executor.getGraphOutput('beat')).toBe(1.5);
    expect(executor.getGraphOutput('delta')).toBe(0.5); // 1.5 - 1 = 0.5
  });

  it('midi.metronome (Time Mode) should trigger on intervals', () => {
    const graph = createGraph('metronome', 'midi.metronome', { mode: 'time' });
    graph.outputs = { 'stream': { nodeId: 'metronome', port: 'stream' } };

    // Input duration 1.0s via config/input default

    const executor = new GraphExecutor(graph, repository);

    // Initial update (T=0). Should trigger?
    // Logic: if lastTriggerTime (-99999) sets to now (0). Returns empty.
    executor.update({ time: 0, clock: { beat: 0, dt: 0.1 } });
    let stream = executor.getGraphOutput('stream') as any[];
    expect(stream.length).toBe(0);

    // T=0.5s. No trigger (Interval 1.0)
    executor.update({ time: 0.5, clock: { beat: 1, dt: 0.1 } });
    stream = executor.getGraphOutput('stream') as any[];
    expect(stream.length).toBe(0);

    // T=1.0s. Trigger! (Crossed 1.0 boundary)
    executor.update({ time: 1.0, clock: { beat: 2, dt: 0.1 } });
    stream = executor.getGraphOutput('stream') as any[];
    expect(stream.length).toBeGreaterThan(0);
    expect(stream[0].fields?.type).toBe('note_on');

    // T=1.5s. No trigger
    executor.update({ time: 1.5, clock: { beat: 3, dt: 0.1 } });
    stream = executor.getGraphOutput('stream') as any[];
    expect(stream.length).toBe(0);

    // T=2.1s. Trigger! (Crossed 2.0 boundary)
    executor.update({ time: 2.1, clock: { beat: 4, dt: 0.1 } });
    stream = executor.getGraphOutput('stream') as any[];
    expect(stream.length).toBeGreaterThan(0);
  });

  it('midi.metronome (Beats Mode) should trigger on quantized beats', () => {
    const graph = createGraph('metronome', 'midi.metronome', { mode: 'beats', beatDenom: 0.25 });
    graph.outputs = { 'stream': { nodeId: 'metronome', port: 'stream' } };

    // Duration default 1.0. Quantized to 1.0 (4 * 0.25).

    const executor = new GraphExecutor(graph, repository);

    // Beat 0. Init.
    executor.update({ time: 0, clock: { beat: 0, dt: 0.1 } });

    // Beat 0.9. No trigger.
    executor.update({ time: 0, clock: { beat: 0.9, dt: 0.1 } });
    expect((executor.getGraphOutput('stream') as any[]).length).toBe(0);

    // Beat 1.0. Trigger!
    executor.update({ time: 0, clock: { beat: 1.0, dt: 0.1 } });
    expect((executor.getGraphOutput('stream') as any[]).length).toBeGreaterThan(0);

    // Large Jump: Beat 1.0 -> 3.2. Should trigger for 2.0 and 3.0?
    // Interval = 1.0.
    // Prev = 1.0. Now = 3.2.
    // Triggers at 2.0, 3.0.
    executor.update({ time: 0, clock: { beat: 3.2, dt: 0.1 } });
    const stream = executor.getGraphOutput('stream') as any[];
    // Should have 2 note-on/note-off pairs = 4 events?
    // Or at least > 0.
    // Logic: for (i=1; i<=triggers...) -> push(on), push(off).
    // 2 triggers * 2 events = 4 events.
    expect(stream.length).toBe(4);
  });
});
