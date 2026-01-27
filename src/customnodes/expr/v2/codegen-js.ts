import { IRGraph, IRNode, OpKind, DataType, DataTypeKind, BlockNode, IfNode, BinaryNode, ConstNode, VarNode, VarDeclNode, AssignNode, ReturnNode, IntrinsicNode, ArrayNode, StructNode, PropAccessNode, PrimitiveType, IndexAccessNode, StructType, PhiNode, UnaryNode, WhileNode, BreakNode, SetPropNode, SetIndexNode } from './ir-types';

export interface CodeGenOptions {
  inputs: Record<string, DataType>;
  outputType?: DataType;
  debug?: boolean;
  checkInputs?: boolean;
}

export function generateJS(ir: IRGraph, options: CodeGenOptions): string {
  const lines: string[] = [];

  lines.push('function compute(input, debug_out) {');

  if (options.debug) {
    lines.push('    function record_debug(line, val) { if(debug_out) debug_out[line] = val; }');
  }

  if (options.checkInputs && options.inputs) {
    for (const [key, type] of Object.entries(options.inputs)) {
      if (type.kind === DataTypeKind.Primitive) {
        const prim = type as PrimitiveType;
        if (prim.name === 'number') {
          lines.push(`    if (typeof input.${key} !== 'number') throw new Error("Input '${key}' must be a number");`);
        } else if (prim.name === 'boolean') {
          lines.push(`    if (typeof input.${key} !== 'boolean') throw new Error("Input '${key}' must be a boolean");`);
        }
      }
      // Arrays/Structs checks could be added here
    }
  }

  lines.push(emitBlock(ir.root as BlockNode, 1, options));

  lines.push('}');

  lines.push('');
  lines.push('module.exports = { compute };');

  return lines.join('\n');
}

function emitBlock(block: BlockNode, indent: number, options: CodeGenOptions): string {
  const lines: string[] = [];
  const spaces = '    '.repeat(indent);

  for (const stmt of block.statements) {
    const code = emitNode(stmt, indent, options);
    if (!code) continue;

    if (stmt.kind === OpKind.If || stmt.kind === OpKind.Block || stmt.kind === OpKind.While) {
      lines.push(code.includes('\n') ? code.split('\n').map((line, idx) => (idx === 0 ? spaces : spaces) + line).join('\n') : `${spaces}${code}`);
    } else {
      lines.push(`${spaces}${code};`);

      if (options.debug) {
        if (stmt.kind === OpKind.VarDecl) {
          const d = stmt as VarDeclNode;
          if (d.debugInfo) lines.push(`${spaces}record_debug(${d.debugInfo.line}, ${d.name});`);
        }
        if (stmt.kind === OpKind.Assign) {
          const a = stmt as AssignNode;
          if (a.debugInfo) lines.push(`${spaces}record_debug(${a.debugInfo.line}, ${a.target});`);
        }
      }
    }
  }
  return lines.join('\n');
}

function emitNode(node: IRNode, indent: number, options: CodeGenOptions): string {
  const inputs = options.inputs;

  switch (node.kind) {
    case OpKind.Const: {
      const c = node as ConstNode;
      if (c.value === null || c.value === undefined) return 'null';
      if (typeof c.value === 'string') return `"${c.value}"`;
      if (typeof c.value === 'boolean') return String(c.value);
      if (Array.isArray(c.value)) {
        const elems = c.value.map((v: any) => {
          if (typeof v === 'object') return JSON.stringify(v);
          return String(v);
        }).join(', ');
        return `[${elems}]`;
      }
      if (typeof c.value === 'object') {
        if ((c.value as any).node && (c.value as any).closure) return 'null /* Inlined Function */';
        return JSON.stringify(c.value);
      }
      return String(c.value);
    }

    case OpKind.Array: {
      const a = node as ArrayNode;
      const elems = a.elements.map(e => emitNode(e, indent, options)).join(', ');
      return `[${elems}]`;
    }

    case OpKind.Var: {
      const v = node as VarNode;
      if (inputs[v.name]) return `input.${v.name}`;
      return v.name;
    }

    case OpKind.Binary: {
      const b = node as BinaryNode;
      return `(${emitNode(b.left, indent, options)} ${b.op} ${emitNode(b.right, indent, options)})`;
    }

    case OpKind.Unary: {
      const u = node as UnaryNode;
      return `(${u.op}${emitNode(u.operand, indent, options)})`;
    }

    case OpKind.Assign: {
      const a = node as AssignNode;
      return `${a.target} = ${emitNode(a.value, indent, options)}`;
    }

    case OpKind.VarDecl: {
      const d = node as VarDeclNode;
      if (d.init) return `let ${d.name} = ${emitNode(d.init, indent, options)}`;
      return `let ${d.name}`;
    }

    case OpKind.If: {
      const i = node as IfNode;
      const cond = emitNode(i.condition, indent, options);
      const thenB = emitBlock(i.thenBlock, indent + 1, options);
      let res = `if (${cond}) {\n${thenB}\n${'    '.repeat(indent)}}`;
      if (i.elseBlock) {
        const elseB = emitBlock(i.elseBlock, indent + 1, options);
        res += ` else {\n${elseB}\n${'    '.repeat(indent)}}`;
      }
      return res;
    }

    case OpKind.While: {
      const w = node as WhileNode;
      const cond = emitNode(w.condition, indent, options);
      const body = emitBlock(w.body, indent + 1, options);
      return `while (${cond}) {\n${body}\n${'    '.repeat(indent)}}`;
    }

    case OpKind.Break: return 'break';

    case OpKind.Return: {
      const r = node as ReturnNode;
      const val = emitNode(r.value, indent, options);
      // Coerce to number if outputType dictates it (for parity with C++/WGSL boolean->int/float)
      if (options.outputType && options.outputType.kind === DataTypeKind.Primitive &&
        (options.outputType as PrimitiveType).name === 'number') {
        return `return Number(${val})`;
      }
      return `return ${val}`;
    }

    case OpKind.Phi: {
      const p = node as PhiNode;
      return `(${emitNode(p.condition, indent, options)} ? ${emitNode(p.trueValue, indent, options)} : ${emitNode(p.falseValue, indent, options)})`;
    }

    case OpKind.Intrinsic: {
      const i = node as IntrinsicNode;
      if (i.library === 'Array') {
        if (i.method === 'length') return `${emitNode(i.args[0], indent, options)}.length`;
        if (i.method === 'get') return `${emitNode(i.args[0], indent, options)}[${emitNode(i.args[1], indent, options)}]`;

        const [obj, ...rest] = i.args;
        const args = rest.map(a => emitNode(a, indent, options)).join(', ');
        return `${emitNode(obj, indent, options)}.${i.method}(${args})`;
      }
      return `Math.${i.method}(${i.args.map(a => emitNode(a, indent, options)).join(', ')})`;
    }

    case OpKind.Struct: {
      const s = node as StructNode;
      const st = s.type as StructType;
      const fields = Object.keys(st.fields).map(k => {
        return `${k}: ${emitNode(s.fields[k], indent, options)}`;
      });
      return `{ ${fields.join(', ')} }`;
    }

    case OpKind.PropAccess: {
      const p = node as PropAccessNode;
      return `${emitNode(p.object, indent, options)}.${p.property}`;
    }

    case OpKind.IndexAccess: {
      const p = node as IndexAccessNode;
      return `${emitNode(p.object, indent, options)}[${emitNode(p.index, indent, options)}]`;
    }

    case OpKind.SetProp: {
      const sp = node as SetPropNode;
      return `${emitNode(sp.object, indent, options)}.${sp.property} = ${emitNode(sp.value, indent, options)}`;
    }

    case OpKind.SetIndex: {
      const si = node as SetIndexNode;
      return `${emitNode(si.object, indent, options)}[${emitNode(si.index, indent, options)}] = ${emitNode(si.value, indent, options)}`;
    }

    case OpKind.Block: {
      const b = node as BlockNode;
      return `{\n${emitBlock(b, indent + 1, options)}\n${'    '.repeat(indent)}}`;
    }

    default: return `/* Unknown Op ${node.kind} */`;
  }
}
