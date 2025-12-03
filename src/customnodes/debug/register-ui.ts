import { registerNode } from '../../structor/node-helpers';
import { debugScopeNode } from './nodes';

registerNode({
  ...debugScopeNode,
  ui: {
    inputEditor: () => import('./nodes.ui').then(m => m.DebugScopeInputEditor),
    getInputEditorHeight: () => Promise.resolve(() => 100)
  }
});
