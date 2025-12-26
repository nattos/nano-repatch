import { primitive_add } from './structor/primitives';
import { primitive_clamp } from './structor/primitives';
import { numberType } from './structor/std-types';

console.log('--- Debugging primitive_add ---');
console.log('Keys:', Object.keys(primitive_add));
console.log('Inputs:', (primitive_add as any).inputs);
console.log('Outputs:', (primitive_add as any).outputs);

const def = primitive_add as any;
const inputsSource = def.extendedInputs || def.inputs || {};
console.log('Inputs Source Keys:', Object.keys(inputsSource));

const inputs = Object.entries(inputsSource).map(([name, val]: [string, any]) => {
  const isExtended = val && typeof val === 'object' && 'type' in val && typeof val.type === 'object' && 'kind' in val.type;
  console.log(`Port ${name}: isExtended=${isExtended}, valKeys=${Object.keys(val || {})}`);
  const type = isExtended ? val.type : val;
  return { name, type };
});
console.log('Parsed Inputs:', JSON.stringify(inputs, null, 2));


console.log('--- Debugging primitive_clamp ---');
// Clamp uses definePrimitiveNode directly
console.log('Inputs:', (primitive_clamp as any).inputs);
const clampSource = (primitive_clamp as any).extendedInputs || (primitive_clamp as any).inputs || {};
const clampInputs = Object.entries(clampSource).map(([name, val]: [string, any]) => {
  const isExtended = val && typeof val === 'object' && 'type' in val && typeof val.type === 'object' && 'kind' in val.type;
  const type = isExtended ? val.type : val;
  return { name, type };
});
console.log('Parsed Clamp Inputs:', JSON.stringify(clampInputs, null, 2));
