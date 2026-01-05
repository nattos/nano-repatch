import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory, ExecutionContext, PrimitiveNodeDefinition } from '../structor';
import { RegionVisibility } from '../repository';
import { midiStreamType } from '../std-types';
import type { GridNode } from '../../builder/state';

// core.ifthen
// Implicitly groups nodes spatially and executes them conditionally.
// Tag: 'onTrigger'

interface IfThenConfig {
  width: number;
  height: number;
  regionX?: number;
  regionY?: number;
  visibility?: 'auto' | 'show' | 'hide';
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
    height: { kind: 'atomic', type: 'number', defaultValue: 3 },
    regionX: { kind: 'atomic', type: 'number', defaultValue: 0, optional: true },
    regionY: { kind: 'atomic', type: 'number', defaultValue: 0, optional: true },
    visibility: { kind: 'atomic', type: 'string', defaultValue: 'show', optional: true }
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
        { type: 'number', label: 'Height', path: 'height', min: 1, step: 1 },
        {
          type: 'tab-bar', label: 'Visibility', path: 'visibility', options: [
            { label: 'Auto', value: 'auto' },
            { label: 'Show', value: 'show' },
            { label: 'Hide', value: 'hide' }
          ], default: 'show'
        }
      ]
    }
  },
  getDisplayLabel: () => 'IfThen',

  getRegion: (config) => ({
    x: config.regionX ?? 0,
    y: config.regionY ?? 0,
    width: config.width ?? 1,
    height: config.height ?? 1,
    visibility: (config.visibility as RegionVisibility) || RegionVisibility.Show
  }),

  getChildren: (node: GridNode, allNodes: Record<string, GridNode>) => {
    const children: string[] = [];
    const config = node.config as unknown as IfThenConfig;

    // Use regionX/Y logic
    const rx = config.regionX ?? 0;
    const ry = config.regionY ?? 0;
    const w = config.width ?? 1;
    const h = config.height ?? 1;

    // Bounding Box (in Grid Coords)
    const x1 = node.x + rx;
    const y1 = node.y + ry;
    const x2 = x1 + w;
    const y2 = y1 + h;

    for (const other of Object.values(allNodes)) {
      if (other.id === node.id) continue;

      // Check if (other.x, other.y) is inside.
      if (other.x >= x1 && other.x < x2 && other.y >= y1 && other.y < y2) {
        children.push(other.id);
      }
    }
    return children;
  },

  execute: (inputs, config, context) => {
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

registerNode(primitive_ifthen);
