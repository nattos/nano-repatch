
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { rhythmicGeneratorPrimitive, patternPrimitive, sequenceStructorType, noteEventStructorType } from './nodes';
import { GraphDefinition, StructorRecord } from '../../structor/structor';
import { NumberType, midiStreamType } from '../../structor/std-types';

describe('NicePattern Integration', () => {
  const repository = new NodeRepository();

  // Register nodes manually for the test repository
  repository.register({
    id: 'nicepattern:rhythmic_generator',
    version: '1.0.0',
    displayName: 'Rhythmic Generator',
    definition: rhythmicGeneratorPrimitive,
    inputs: [],
    outputs: [{ name: 'seq_out', type: sequenceStructorType, description: 'Generated sequence' }],
    compileConfig: (uiConfig) => ({ fields: { targetNote: uiConfig?.targetNote ?? 60, density: uiConfig?.density ?? 0.5 }, untagged: [] }),
  });

  repository.register({
    id: 'nicepattern:pattern',
    version: '1.0.0',
    displayName: 'Pattern',
    definition: patternPrimitive,
    inputs: [{ name: 'seq_in', type: sequenceStructorType, description: 'Input sequence(s)', redirect: 'untagged' }],
    outputs: [{ name: 'midi_out', type: midiStreamType, description: 'Real-time MIDI stream' }],
    compileConfig: (uiConfig) => ({ fields: {}, untagged: [] }),
  });

  const createGraph = (nodes: any, connections: any[], inputs: any = {}, outputs: any = {}): GraphDefinition => ({
    id: 'test-graph',
    kind: 'graph',
    type: { kind: 'graph', inputs: { kind: 'record', fields: {}, untagged: [] }, outputs: { kind: 'record', fields: {}, untagged: [] } },
    nodes,
    connections,
    inputs,
    outputs
  });

  it('should generate a rhythmic sequence', () => {
    const graph = createGraph(
      {
        'gen': { definitionId: 'nicepattern:rhythmic_generator', defaultConfig: { fields: { targetNote: 60, density: 1.0 }, untagged: [] } }
      },
      [],
      {},
      { 'seq': { nodeId: 'gen', port: 'seq_out' } }
    );

    const executor = new GraphExecutor(graph, repository);
    executor.update({ clock: { beat: 0, dt: 0 } });

    const output = executor.getGraphOutput('seq') as any[];
    expect(output).toBeDefined();
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBe(16);
    // Density 1.0 -> all steps should have a note
    expect(output[0].fields.noteIndex).toBe(60);
  });

  it('should process pattern events from sequence', () => {
    // Generator -> Pattern
    const graph = createGraph(
      {
        'gen': { definitionId: 'nicepattern:rhythmic_generator', defaultConfig: { fields: { targetNote: 60, density: 0.5 }, untagged: [] } },
        'pat': { definitionId: 'nicepattern:pattern', defaultConfig: { fields: {}, untagged: [] } }
      },
      [
        { fromNode: 'gen', fromPort: 'seq_out', toNode: 'pat', toPort: 'seq_in' }
      ],
      {},
      { 'midi': { nodeId: 'pat', port: 'midi_out' } }
    );

    const executor = new GraphExecutor(graph, repository);

    // Initial update (beat 0)
    executor.update({ clock: { beat: 0, dt: 0.1 } });

    let stream = executor.getGraphOutput('midi') as any[];

    // At beat 0, step 0. If density 0.5, step 0 usually has a note.
    // We expect a Note On event.

    expect(stream).toBeDefined();
    expect(Array.isArray(stream)).toBe(true);

    const noteOn = stream.find(e => (e.fields.status & 0xF0) === 0x90 && e.fields.data2 > 0);
    expect(noteOn).toBeDefined();
    expect(noteOn.fields.data1).toBe(60);

    // Advance clock to beat 0.25 (next step)
    // beat = 0.25 -> step = 1.
    // i=1: (1*8)%16 = 8. 8 < 8 -> False. So step 1 is empty.
    // We expect a Note Off for the previous note.

    executor.update({ clock: { beat: 0.25, dt: 0.1 } });
    stream = executor.getGraphOutput('midi') as any[];

    const noteOff = stream.find(e => (e.fields.status & 0xF0) === 0x80 || ((e.fields.status & 0xF0) === 0x90 && e.fields.data2 === 0));
    expect(noteOff).toBeDefined();
    expect(noteOff.fields.data1).toBe(60);
  });
});
