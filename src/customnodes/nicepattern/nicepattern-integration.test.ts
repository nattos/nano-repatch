
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { rhythmicGeneratorPrimitive, patternPrimitive, sequenceStructorType, noteEventStructorType } from './nodes';
import { GraphDefinition, StructorRecord } from '../../structor/structor';
import { NumberType } from '../../structor/std-types';

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
    outputs: [{ name: 'event_out', type: noteEventStructorType, description: 'Real-time note events' }],
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
      { 'event': { nodeId: 'pat', port: 'event_out' } }
    );

    const executor = new GraphExecutor(graph, repository);

    // Initial update (beat 0)
    executor.update({ clock: { beat: 0, dt: 0.1 } });

    let event = executor.getGraphOutput('event') as any;
    // At beat 0, step 0. If density 0.5, step 0 usually has a note (Euclidean-ish distribution).
    // The implementation: if ((i * numEvents) % SEQUENCE_LENGTH < numEvents)
    // 0.5 * 16 = 8 events.
    // i=0: 0 < 8 -> True.

    // Note: event is a StructorRecord { fields: { onNote: ..., hold: ... } }
    // But wait, `patternPrimitive` returns `{ event_out: noteEvent }`.
    // `noteEvent` is a JS object.
    // `definePrimitiveNode` wraps it into StructorRecord.
    // So `event` should be a StructorRecord.

    // Let's check the structure
    // console.log('Event Output:', JSON.stringify(event, null, 2));

    expect(event).toBeDefined();
    expect(event.fields.hold).toBe(false);
    // Wait, hold is false in generator.

    // Check onNote
    if (event.fields.onNote) {
      expect(event.fields.onNote.fields.note).toBe(60);
    }

    // Advance clock to beat 0.25 (next step, since 4 steps per beat)
    // beat = 0.25 -> step = 1.
    // i=1: (1*8)%16 = 8. 8 < 8 -> False. So step 1 is empty.

    executor.update({ clock: { beat: 0.25, dt: 0.1 } });
    event = executor.getGraphOutput('event') as any;

    // Should be note off or nothing?
    // Pattern logic:
    // if (currentStep.noteIndex !== lastStep.noteIndex)
    // lastStep (60) != currentStep (null).
    // -> offNote = lastStep.noteIndex (60).

    expect(event.fields.offNote).toBeDefined();
    expect(event.fields.offNote.fields.note).toBe(60);
  });
});
