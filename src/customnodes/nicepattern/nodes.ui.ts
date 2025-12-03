import './nodes';
import { createGenericInspector } from '../../views/inspector/generic-inspector';

// Rhythmic Generator
export const RhythmicInspector = createGenericInspector([
  { type: 'number', label: 'Target Note', path: 'targetNote' },
  { type: 'slider', label: 'Density', path: 'density', min: 0, max: 1, step: 0.05 }
]);

// Chaos Generator
export const ChaosInspector = createGenericInspector([
  { type: 'number', label: 'Min Note', path: 'minNote' },
  { type: 'number', label: 'Max Note', path: 'maxNote' },
  { type: 'slider', label: 'Density', path: 'density', min: 0, max: 1, step: 0.05 },
  { type: 'number', label: 'Seed', path: 'seed' }
]);

// Layer Nodes
export const LayerInspector = createGenericInspector([
  { type: 'number', label: 'Target Note', path: 'targetNote' }
]);
