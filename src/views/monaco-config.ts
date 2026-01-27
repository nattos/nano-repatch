import type * as Monaco from 'monaco-editor';
import { generateDTS } from '../customnodes/expr/v2/generate-dts';

let isConfigured = false;

export function configureMonaco(monaco: typeof Monaco) {
  if (isConfigured) return;
  isConfigured = true;

  // Configure TypeScript Compiler Options
  // Access via any to bypass deprecation or new namespace location
  const tsLanguage = (monaco as any).typescript || (monaco.languages as any).typescript;

  if (!tsLanguage) {
    console.warn("Monaco TypeScript language service not found.");
    return;
  }

  const defaults = tsLanguage.typescriptDefaults;

  defaults.setCompilerOptions({
    target: tsLanguage.ScriptTarget?.ES2015 || 2,
    allowNonTsExtensions: true,
    moduleResolution: tsLanguage.ModuleResolutionKind?.NodeJs || 2,
    module: tsLanguage.ModuleKind?.CommonJS || 1,
    noEmit: true,
    typeRoots: [],

    // Disable standard library
    noLib: true,
  });

  // Inject Custom Standard Library
  const stdLibContent = generateDTS();
  defaults.addExtraLib(stdLibContent, 'ts:filename/stdlib.d.ts');
}
