import { StructorType } from './structor';

export type TriggerMode = 'midi' | 'primitive';

export function detectTriggerMode(inputType: StructorType | undefined): TriggerMode {
  if (!inputType) return 'primitive'; // Default to primitive if unknown

  // Check if it looks like a MIDI stream
  // MIDI Stream = Array of Records
  // We assume anything else is a primitive signal
  const isMidi = (inputType.kind === 'array' && (inputType as any).element?.kind === 'record');
  // Note: type-helpers usually uses 'element' for array element type, but check if it's 'elementType' in some variants?
  // Looking at core_ifthen.ts, it accessed (inputType as any).elementType?
  // Let's verify standard types. 'ArrayType' interface usually has 'element'.
  // core_pack.ts:99 uses 'element'.
  // logic_select.ts checks 'inputType.fields'.

  if (isMidi) return 'midi';

  return 'primitive';
}

export function shouldTrigger(input: any, mode: TriggerMode): boolean {
  if (mode === 'primitive') {
    // Primitive Mode: Check for Truthy
    if (Array.isArray(input)) {
      // If array (from stream or spread), trigger if ANY is truthy
      for (const val of input) {
        if (val) return true;
      }
      return false;
    } else {
      // Scalar
      return !!input;
    }
  } else {
    // MIDI Mode (Default)
    const stream = input || [];
    if (Array.isArray(stream)) {
      for (const event of stream) {
        // Check for Note On with velocity > 0
        if (event && event.type === 'note_on' && (event.velocity ?? 0) > 0) {
          return true;
        }
      }
    }
    return false;
  }
}
