
import { defaultNodeRepository } from '../../structor/repository';

export function registerNicePatternUI() {
  // Magneto
  const magnetoType = defaultNodeRepository.getNodeType('nicepattern.magneto');
  if (magnetoType) {
    (magnetoType as any).ui = {
      ...((magnetoType as any).ui || {}),
      body: () => import('./magneto-editor').then(m => m.MagnetoEditorRenderer),
      getBodyHeight: () => Promise.resolve(() => 272)
    };
  }

  // Orthomod
  const orthomodType = defaultNodeRepository.getNodeType('nicepattern.orthomod');
  if (orthomodType) {
    (orthomodType as any).ui = {
      ...((orthomodType as any).ui || {}),
      body: () => import('./orthomod-editor').then(m => m.OrthomodEditorRenderer),
      getBodyHeight: () => Promise.resolve(() => 260)
    };
  }
}


