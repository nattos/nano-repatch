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
  lines.push('diagnostic(off, derivative_uniformity);');
  lines.push('');
  const structs = collectStructs(ir, options.inputs);

  structs.forEach((s, name) => {
    lines.push(`struct ${name} {`);
    const keys = Object.keys(s.fields).sort();
    if (keys.length === 0) {
      lines.push('    _dummy: f32,');
    } else {
      keys.forEach(k => {
        lines.push(`    ${k}: ${typeToWGSL(s.fields[k])},`);
      });
    }
    lines.push('};');
    lines.push('');
  });

  lines.push('struct Input {');
  const inputEntries = Object.entries(options.inputs);
  if (inputEntries.length === 0) {
    lines.push('    _dummy: f32,');
  } else {
    for (const [k, v] of inputEntries) {
      lines.push(`    ${k}: ${typeToWGSL(v)},`);
    }
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
      let valCode = emitNode(r.value, options);

      // Heuristic: If we are returning a Boolean to an f32 output, cast it.
      // This is needed because 'select(0,1,bool)' is how we output booleans to storage buffers.
      // And we often default outputType to 'number' (f32) in tests.
      if (options.outputType &&
        options.outputType.kind === DataTypeKind.Primitive &&
        (options.outputType as PrimitiveType).name === 'number') {

        if (isBooleanExpr(r.value)) {
          valCode = `select(0.0, 1.0, ${valCode})`;
        }
      }

      lines.push(`${spaces}output.result = ${valCode};`);
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


function isBooleanExpr(node: IRNode): boolean {
  if (node.kind === OpKind.Const) {
    return typeof (node as ConstNode).value === 'boolean';
  }
  if (node.kind === OpKind.Binary) {
    const op = (node as BinaryNode).op;
    return ['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(op);
  }
  if (node.kind === OpKind.Unary) {
    return (node as UnaryNode).op === '!';
  }
  if (node.type && node.type.kind === DataTypeKind.Primitive && (node.type as PrimitiveType).name === 'boolean') {
    return true;
  }
  return false;
}

// Helper to ensure expression results in f32
function emitValueAsFloat(node: IRNode, options: WGSLGenOptions): string {
  if (isBooleanExpr(node)) {
    return `select(0.0, 1.0, ${emitNode(node, options)})`;
  }
  // Attempt standard emit
  const code = emitNode(node, options);
  // If it looks like a bool constant "true"/"false" or comparison, we might have missed it in isBooleanExpr?
  // But assumes implicit is float if not bool.
  return code;
}

// Helper to ensure expression results in bool
function emitValueAsBool(node: IRNode, options: WGSLGenOptions): string {
  if (isBooleanExpr(node)) {
    return emitNode(node, options);
  }
  // Assume float, check != 0.0
  return `(${emitNode(node, options)} != 0.0)`;
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
      // Handle Logic Ops with JS Semantics (Coalescing)
      if (b.op === '&&' || b.op === '||') {
        // If either operand is non-boolean (number), treat as float selection
        const leftBool = isBooleanExpr(b.left);
        const rightBool = isBooleanExpr(b.right);

        if (!leftBool || !rightBool) {
          // Mixed or both numbers. Convert all to float and use select.
          const l = emitValueAsFloat(b.left, options);
          const r = emitValueAsFloat(b.right, options);

          // JS Semantics:
          // OR: a || b -> if a truthy return a, else b.
          // WGSL select(falseVal, trueVal, cond).
          // cond = a != 0.0
          // select(b, a, a!=0)
          if (b.op === '||') return `select(${r}, ${l}, ${l} != 0.0)`;

          // AND: a && b -> if a truthy return b, else a.
          // cond = a != 0.0
          // select(a, b, a!=0)
          if (b.op === '&&') return `select(${l}, ${r}, ${l} != 0.0)`;
        }
        // Fallthrough for purely boolean logic
      }
      return `(${emitNode(b.left, options)} ${b.op} ${emitNode(b.right, options)})`;
    }
    case OpKind.Assign: {
      const a = node as AssignNode;
      // Assign needs type match. We assume target is inferred correctly.
      return `${safeName(a.target)} = ${emitNode(a.value, options)}`;
    }
    case OpKind.VarDecl: {
      const d = node as VarDeclNode;
      let typeStr = typeToWGSL(d.type || { kind: DataTypeKind.Primitive, name: 'number' } as any);
      let init = d.init ? ` = ${emitNode(d.init, options)}` : '';
      // If init is boolean and target is f32 (e.g. inferred from 'number'), we should cast?
      // But VarDecl type comes from TS inference which might say 'boolean | number'.
      // For now, trust emitNode or rely on WGSL error if types mismatch,
      // OR upgrade VarDecl to auto-cast init if type is f32.
      if (d.type && (d.type as PrimitiveType).name === 'number' && d.init && isBooleanExpr(d.init)) {
        init = ` = select(0.0, 1.0, ${emitNode(d.init, options)})`;
      }
      return `var ${safeName(d.name)} : ${typeStr}${init}`;
    }
    case OpKind.While: {
      const w = node as WhileNode;
      // Condition must be boolean
      return `while (${emitValueAsBool(w.condition, options)}) {\n${emitBlock(w.body, 1, options)}\n}`;
    }
    case OpKind.If: {
      const i = node as IfNode;
      let res = `if (${emitValueAsBool(i.condition, options)}) {\n${emitBlock(i.thenBlock, 1, options)}\n}`;
      if (i.elseBlock) res += ` else {\n${emitBlock(i.elseBlock, 1, options)}\n}`;
      return res;
    }
    // ... rest strict logical ops ...
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
