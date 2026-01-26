import { IRGraph, IRNode, OpKind, DataType, DataTypeKind, BlockNode, IfNode, BinaryNode, ConstNode, VarNode, VarDeclNode, AssignNode, ReturnNode, IntrinsicNode, ArrayNode, StructNode, PropAccessNode, PrimitiveType, IndexAccessNode, StructType, PhiNode, UnaryNode, WhileNode, BreakNode, SetPropNode, SetIndexNode } from './ir-types';

export interface WGSLGenOptions {
  inputs: Record<string, DataType>;
  outputType?: DataType;
}

const F32 = 'f32';
const I32 = 'i32';
const BOOL = 'bool';

// Helper to sanitize names
function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Struct Collection
function collectStructs(ir: IRGraph, inputs: Record<string, DataType>): Map<string, StructType> {
  const structs = new Map<string, StructType>();

  function visitType(t: DataType) {
    if (!t) return;
    if (t.kind === DataTypeKind.Struct) {
      const s = t as StructType;
      const name = getStructName(s);
      if (!structs.has(name)) {
        structs.set(name, s);
        Object.values(s.fields).forEach(visitType);
      }
    } else if (t.kind === DataTypeKind.Array) {
      visitType((t as any).elementType);
    }
  }

  Object.values(inputs).forEach(visitType);
  visitType(ANY_OUTPUT_TYPE(ir));

  const stack = [ir.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (!n || typeof n !== 'object') continue;
    if ((n as any).type) visitType((n as any).type);

    if (n.kind === OpKind.Block) stack.push(...(n as BlockNode).statements);
    else if (n.kind === OpKind.If) {
      stack.push((n as IfNode).condition, (n as IfNode).thenBlock);
      if ((n as IfNode).elseBlock) stack.push((n as IfNode).elseBlock!);
    }
    else if (n.kind === OpKind.While) stack.push((n as WhileNode).condition, (n as WhileNode).body);
  }
  return structs;
}

function getStructName(s: StructType): string {
  if (s.name) return s.name;
  const keys = Object.keys(s.fields).sort();
  return `Struct_${keys.join('_')}`;
}

function typeToWGSL(type: DataType): string {
  switch (type.kind) {
    case DataTypeKind.Primitive: {
      const p = type as PrimitiveType;
      if (p.name === 'number') return F32;
      if (p.name === 'boolean') return BOOL;
      if (p.name === 'void') return 'void';
      return F32;
    }
    case DataTypeKind.Array: {
      const inner = (type as any).elementType;
      return `array<${typeToWGSL(inner)}>`;
    }
    case DataTypeKind.Struct: return getStructName(type as StructType);
    default: return F32;
  }
}

function ANY_OUTPUT_TYPE(ir: IRGraph): DataType {
  return { kind: DataTypeKind.Primitive, name: 'void' } as any;
}

export function generateWGSL(ir: IRGraph, options: WGSLGenOptions): string {
  const lines: string[] = [];
  const structs = collectStructs(ir, options.inputs);

  structs.forEach((s, name) => {
    lines.push(`struct ${name} {`);
    const keys = Object.keys(s.fields).sort();
    keys.forEach(k => {
      lines.push(`    ${k}: ${typeToWGSL(s.fields[k])},`);
    });
    lines.push('};');
    lines.push('');
  });

  lines.push('struct Input {');
  for (const [k, v] of Object.entries(options.inputs)) {
    lines.push(`    ${k}: ${typeToWGSL(v)},`);
  }
  lines.push('};');
  lines.push('');

  lines.push('struct Output {');
  if (options.outputType) {
    lines.push(`    result: ${typeToWGSL(options.outputType)},`);
  } else {
    lines.push(`    result: f32,`);
  }
  lines.push('};');
  lines.push('');

  lines.push('@group(0) @binding(0) var<storage, read> input: Input;');
  lines.push('@group(0) @binding(1) var<storage, read_write> output: Output;');
  lines.push('');

  lines.push('@compute @workgroup_size(1)');
  lines.push('fn main() {');
  // Force bindings to be active to prevent dead-code stripping
  lines.push('    _ = &input;');
  lines.push('    _ = &output;');
  lines.push(emitBlock(ir.root as BlockNode, 1, options));
  lines.push('}');

  return lines.join('\n');
}

function emitBlock(block: BlockNode, indent: number, options: WGSLGenOptions): string {
  const lines: string[] = [];
  const spaces = '    '.repeat(indent);

  for (const stmt of block.statements) {
    if (stmt.kind === OpKind.Return) {
      const r = stmt as ReturnNode;
      lines.push(`${spaces}output.result = ${emitNode(r.value, options)};`);
      lines.push(`${spaces}return;`);
      continue;
    }

    const code = emitNode(stmt, options);
    if (code) {
      if (stmt.kind === OpKind.If || stmt.kind === OpKind.While || stmt.kind === OpKind.Block) {
        lines.push(code.includes('\n') ? code.split('\n').map((l, i) => (i === 0 ? spaces : spaces) + l).join('\n') : `${spaces}${code}`);
      } else {
        lines.push(`${spaces}${code};`);
      }
    }
  }
  return lines.join('\n');
}

function emitVal(val: any, type: DataType, options: WGSLGenOptions): string {
  if (typeof val === 'number') {
    const s = String(val);
    return s.includes('.') ? s : s + '.0';
  }
  if (typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    const inner = (type as any).elementType;
    const args = val.map((v: any) => emitVal(v, inner, options)).join(', ');
    return `${typeToWGSL(type)}(${args})`;
  }
  if (typeof val === 'object' && val !== null && type.kind === DataTypeKind.Struct) {
    const name = getStructName(type as StructType);
    const keys = Object.keys((type as StructType).fields).sort();
    const args = keys.map(k => emitVal(val[k], (type as StructType).fields[k], options)).join(', ');
    return `${name}(${args})`;
  }
  return '0.0';
}

function emitNode(node: IRNode, options: WGSLGenOptions): string {
  switch (node.kind) {
    case OpKind.Const: {
      const c = node as ConstNode;
      if (typeof c.value === 'number') {
        const s = String(c.value);
        return s.includes('.') ? s : s + '.0';
      }
      if (typeof c.value === 'boolean') return String(c.value);
      // Objects/Arrays
      if (typeof c.value === 'object' || Array.isArray(c.value)) {
        return emitVal(c.value, c.type, options);
      }
      return '0.0';
    }
    case OpKind.Var: {
      const v = node as VarNode;
      if (options.inputs[v.name]) return `input.${v.name}`;
      return safeName(v.name);
    }
    case OpKind.Binary: {
      const b = node as BinaryNode;
      return `(${emitNode(b.left, options)} ${b.op} ${emitNode(b.right, options)})`;
    }
    case OpKind.Assign: {
      const a = node as AssignNode;
      return `${safeName(a.target)} = ${emitNode(a.value, options)}`;
    }
    case OpKind.VarDecl: {
      const d = node as VarDeclNode;
      let typeStr = typeToWGSL(d.type || { kind: DataTypeKind.Primitive, name: 'number' } as any);
      let init = d.init ? ` = ${emitNode(d.init, options)}` : '';
      return `var ${safeName(d.name)} : ${typeStr}${init}`;
    }
    case OpKind.While: {
      const w = node as WhileNode;
      return `while (${emitNode(w.condition, options)}) {\n${emitBlock(w.body, 1, options)}\n}`;
    }
    case OpKind.If: {
      const i = node as IfNode;
      let res = `if (${emitNode(i.condition, options)}) {\n${emitBlock(i.thenBlock, 1, options)}\n}`;
      if (i.elseBlock) res += ` else {\n${emitBlock(i.elseBlock, 1, options)}\n}`;
      return res;
    }
    case OpKind.Block: {
      const b = node as BlockNode;
      return `{\n${emitBlock(b, 1, options)}\n}`;
    }
    case OpKind.Intrinsic: {
      const i = node as IntrinsicNode;
      return `${i.method}(${i.args.map(a => emitNode(a, options)).join(', ')})`;
    }
    case OpKind.PropAccess: {
      const p = node as PropAccessNode;
      return `${emitNode(p.object, options)}.${p.property}`;
    }
    case OpKind.Struct: {
      const s = node as StructNode;
      const name = getStructName(s.type as StructType);
      const keys = Object.keys((s.type as StructType).fields).sort();
      const args = keys.map(k => emitNode(s.fields[k], options)).join(', ');
      return `${name}(${args})`;
    }
    case OpKind.Array: {
      const a = node as ArrayNode;
      const type = typeToWGSL(a.type);
      return `${type}(${a.elements.map(e => emitNode(e, options)).join(', ')})`;
    }
    case OpKind.Break: return 'break;';
    default: return `/* Unknown ${node.kind} */`;
  }
}
