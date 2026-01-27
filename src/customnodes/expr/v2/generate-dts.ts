import { libSignatures } from './stdlib';

export function generateDTS(): string {
  const lines: string[] = [];

  // Preamble
  lines.push('// Auto-generated Standard Library Definitions');
  lines.push('// Do not edit manually');
  lines.push('');

  // Group by namespace
  const mathMethods: string[] = [];
  const arrayMethods: string[] = [];
  const arrayStaticMethods: string[] = [];
  const globals: string[] = [];

  for (const [key, decl] of libSignatures.entries()) {
    if (key.startsWith('Math.')) {
      // (method) Math.sin(x: number): number
      // We need to extract the signature part: "sin(x: number): number"
      const match = decl.match(/Math\.(\w+)(\(.*\): \w+)/);
      if (match) {
        mathMethods.push(`    ${match[1]}${match[2]};`);
      }
    } else if (key.startsWith('Array.prototype.') || (key.startsWith('Array.') && decl.includes('Array<T>'))) {
      // Instance methods: (method) Array<T>.push(...items: T[]): number
      const match = decl.match(/Array<T>\.(\w+)(<.*>)?(\(.*\): .+)/);
      if (match) {
        arrayMethods.push(`    ${match[1]}${match[2] || ''}${match[3]};`);
      }
    } else if (key.startsWith('Array.')) {
      // Static: (method) Array.isArray(arg: any): boolean
      const match = decl.match(/Array\.(\w+)(\(.*\): .+)/);
      if (match) {
        arrayStaticMethods.push(`    static ${match[1]}${match[2]};`);
      }
    } else {
      // Globals
      globals.push(`declare ${decl};`);
    }
  }

  // Emit Math
  if (mathMethods.length > 0) {
    lines.push('declare const Math: {');
    lines.push(...mathMethods);
    lines.push('    PI: number;');
    lines.push('    E: number;');
    lines.push('};');
    lines.push('');
  }

  // Emit Array Interface extensions?
  // Actually, TS has Array. We just want to ensure our specific subset is known or we assume standard lib?
  // If we are replacing the env, we declare global interfaces.
  if (arrayMethods.length > 0) {
    lines.push('interface Array<T> {');
    lines.push('    length: number;');
    lines.push(...arrayMethods);
    lines.push('}');
    lines.push('');
  }

  if (arrayStaticMethods.length > 0) {
    lines.push('declare var Array: {');
    lines.push('    new <T>(...len: any[]): Array<T>;');
    lines.push('    (len: number): any[];');
    lines.push(...arrayStaticMethods);
    lines.push('};');
    lines.push('');
  }

  // Emit Globals
  lines.push(...globals);

  return lines.join('\n');
}
