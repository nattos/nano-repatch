import { registerNode, EnhancedNodeDefinition } from './node-helpers';
import { ALL_PRIMITIVES } from './primitives';

export function registerPrimitives() {
  for (const prim of ALL_PRIMITIVES) {
    // Cast to EnhancedNodeDefinition because we know our updated registerNode handles primitive inputs/outputs
    registerNode(prim as unknown as EnhancedNodeDefinition);
  }
}
