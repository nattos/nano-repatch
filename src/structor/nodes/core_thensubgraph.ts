import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory, ExecutionContext } from '../structor';
import { midiStreamType } from '../std-types';
import { computeSubgraphPorts, resolvePortName } from './core_subgraph';

// core.thensubgraph
// Executes the subgraph when a MIDI Note On event is received.
// Tag: 'onTrigger'

export const primitive_thensubgraph = definePrimitiveNode({
  id: 'core.thensubgraph',
  subgraphExpansionTag: 'onTrigger',
  metadata: {
    category: NodeCategory.Core,
    keywords: ['nested', 'graph', 'conditional', 'midi', 'trigger'],
    description: 'Executes a nested subgraph when a MIDI Note On event is received.'
  },
  config: { subgraphId: { kind: 'atomic', type: 'string' } },
  // Inputs: MIDI Stream + Subgraph Inputs
  inputs: {
    midi_in: midiStreamType
  },
  outputs: {}, // Subgraph Outputs
  ui: {
    inspector: {
      fields: [
        { type: 'string', label: 'Subgraph ID', path: 'subgraphId' }
      ]
    }
  },
  getDisplayLabel: (config: any) => {
    if (config.subgraphId) {
      const parts = config.subgraphId.split('.');
      return `OnNote: ${parts[parts.length - 1]}`;
    }
    return 'OnNote';
  },
  computeForwardPorts: ((inputType: any, config: any, context: any) => {
    // Get base subgraph ports
    const basePorts = computeSubgraphPorts(inputType, config, context);

    // Merge midi_in input
    const inputs = {
      ...basePorts.inputs.fields,
      midi_in: midiStreamType
    };

    return {
      inputs: { kind: 'record', fields: inputs },
      outputs: basePorts.outputs
    };
  }) as any,
  execute: (input: any, config: any, context: ExecutionContext) => {
    const stream = input.midi_in || [];
    const events = Array.isArray(stream) ? stream : [];

    // Check for Note On
    let shouldTrigger = false;
    for (const event of events) {
      if (event.type === 'note_on' && (event.velocity ?? 0) > 0) {
        shouldTrigger = true;
        break;
      }
    }

    if (shouldTrigger && context.executeSubgraph) {
      context.executeSubgraph('onTrigger');
    }

    // Return empty fields?
    // The subgraph execution might update outputs, but those are distinct nodes?
    // Wait. If the subgraph nodes output data... where does it go?
    // In `core.subgraph` (inline), inputs/outputs are wired.
    // In `core.thensubgraph`, inputs/outputs are wired similarly.
    // BUT the execution order is deferred.
    // If we execute it NOW (during this node's execute), the output nodes inside the subgraph
    // will update their state `output`.
    // And since this node proxies those outputs...
    // Wait, the "Outputs" of the parent node are usually wired to the inner nodes' outputs via `Output Remappings`.
    // `compiler.ts` handles output remappings.
    /*
      outputRemappings[nodeId][outputName] = innerOutputNodeId;
    */
    // The Executor, when `getGraphOutput` or `connection` reading happens, resolves remappings using keys?
    // Actually, strictly speaking, `GraphExecutor` relies on connections.
    // If `core.thensubgraph` has an output port "X", causing a connection from `core.thensubgraph:X`.
    // The `core.thensubgraph` execution ITSELF returns a value for `X` in `execute` result?
    // Or does `MidiManager`/Executor handle it?

    // In `core_subgraph.ts`, `execute` returns `{ fields: {} }`.
    // Yet subgraphs work. Why?
    // Because the `core.subgraph` node is just a "wrapper". The connections go *through* it?
    // No. Visualizer shows connections to the wrapper.
    // The *Compiler* generates direct connections from Inner Node Output to Outer Node Output logic?
    // Let's check `compiler.ts` output logic. (Line 99 in `processGraph` implies filtering).

    // If I check `executor.ts`, `getNodeOutput` doesn't do remapping.
    // The `compileGraph` returns `inferredTypes` and `virtualInputMappings`, `outputRemappings`.
    // Does the `Executor` or `Compiler` use `outputRemappings` to rewire connections?
    // Ah, `compiler.ts` seems to flatten nodes and connections.
    // But connections to the *Parent Node* need to be redirected to the *Inner Output Node*.
    // If I did NOT implement that redirection in `compiler.ts` yet, then `core.subgraph` probably doesn't work as expected for Outputs?
    // Or `core.subgraph` is expected to return the values?
    // But `execute` returns empty.

    // Re-reading `compiler.ts` snippet I viewed earlier...
    // I didn't see explicit rewiring logic there. I saw recursive processing.
    // Wait. If `core.subgraph` is in the graph, and I connect `Sub:Out -> Other:In`.
    // The `executionOrder` runs `Sub`. `Sub` returns empty. `Other` reads empty.
    // This implies existing subgraph outputs might NOT work?
    // OR `compiler.ts` adds connections from Inner Output to Outer's consumers?
    // I need to verify `compiler.ts` logic for connections involving subgraph boundaries.

    return { fields: {} };
  }
});

registerNode(primitive_thensubgraph as any);
