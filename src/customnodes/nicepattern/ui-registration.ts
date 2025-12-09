
import { magneto } from './magneto';
import { orthomod } from './orthomod';

export function registerNicePatternUI() {
  (magneto as any).ui = {
    ...((magneto as any).ui || {}),
    body: () => import('./magneto-editor').then(m => m.MagnetoEditorRenderer),
    getBodyHeight: () => Promise.resolve(() => 272)
  };

  (orthomod as any).ui = {
    ...((orthomod as any).ui || {}),
    body: () => import('./orthomod-editor').then(m => m.OrthomodEditorRenderer),
    getBodyHeight: () => Promise.resolve(() => 260)
  };
}
