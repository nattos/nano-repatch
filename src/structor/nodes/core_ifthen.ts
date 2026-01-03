import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory, ExecutionContext, PrimitiveNodeDefinition } from '../structor';
import { midiStreamType } from '../std-types';
import type { GridNode } from '../../builder/state';

// core.ifthen
// Implicitly groups nodes spatially and executes them conditionally.
// Tag: 'onTrigger'

interface IfThenConfig {
  width: number;
  height: number;
}

export const primitive_ifthen = definePrimitiveNode({
  id: 'core.ifthen',
  subgraphExpansionTag: 'onTrigger',
  metadata: {
    category: NodeCategory.Core,
    keywords: ['group', 'conditional', 'spatial', 'if', 'then'],
    description: 'Spatially groups nodes and executes them when a MIDI Note On event is received.'
  },
  config: {
    width: { kind: 'atomic', type: 'number', defaultValue: 3 },
    height: { kind: 'atomic', type: 'number', defaultValue: 3 }
  },
  // Inputs: MIDI Stream (Trigger)
  inputs: {
    midi_in: midiStreamType
  },
  outputs: {},
  ui: {
    inspector: {
      fields: [
        { type: 'number', label: 'Width', path: 'width', min: 1, step: 1 },
        { type: 'number', label: 'Height', path: 'height', min: 1, step: 1 }
      ]
    }
  },
  getDisplayLabel: () => 'IfThen',

  getChildren: (node: GridNode, allNodes: Record<string, GridNode>) => {
    const children: string[] = [];
    const config = node.config as unknown as IfThenConfig;
    const w = config.width || 3;
    const h = config.height || 3;

    // Bounding Box (in Grid Coords)
    // Note: GridNode x,y are top-left? Yes.
    // We assume strict containment? Or partial?
    // Let's go with Center Point Containment for robustness.

    const x1 = node.x;
    const y1 = node.y;
    const x2 = node.x + w;
    const y2 = node.y + h;

    for (const other of Object.values(allNodes)) {
      if (other.id === node.id) continue;

      // Determine other node's center or position.
      // Ideally we check center. But we don't know other node's size easily here without lookup.
      // Let's assume Top-Left for now, or check if (x,y) is inside.
      // Better: Check if (other.x, other.y) is inside.

      if (other.x >= x1 && other.x < x2 && other.y >= y1 && other.y < y2) {
        children.push(other.id);
      }
    }
    return children;
  },

  execute: (inputs: any, config: any, context: ExecutionContext) => {
    const stream = inputs.midi_in || [];
    let shouldTrigger = false;

    if (Array.isArray(stream)) {
      for (const event of stream) {
        if (event.type === 'note_on' && event.velocity > 0) {
          shouldTrigger = true;
          break;
        }
      }
    }

    if (shouldTrigger && context.executeSubgraph) {
      context.executeSubgraph('onTrigger');
    }

    return { fields: {} };
  }
});

registerNode(primitive_ifthen as any);
