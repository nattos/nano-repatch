import { IRGraph, IRNode, OpKind, DataType, DataTypeKind, BlockNode, IfNode, BinaryNode, ConstNode, VarNode, VarDeclNode, AssignNode, ReturnNode, IntrinsicNode, ArrayNode, StructNode, PropAccessNode, PrimitiveType, IndexAccessNode } from './ir-types';

export interface CodeGenOptions {
  inputs: Record<string, DataType>; // Map of input names to types
  outputType?: DataType; // Expected output type (or inferred)
}

function typeToCpp(type: DataType): string {
  switch (type.kind) {
    case DataTypeKind.Primitive: {
      const p = type as PrimitiveType;
      if (p.name === 'number') return 'double';
      if (p.name === 'boolean') return 'bool';
      if (p.name === 'void') return 'void';
      return 'auto';
    }
    case DataTypeKind.Array: {
      // Assuming Array<number> -> std::vector<float>
      // Simplification: We only support vector<float> for now in C++ harness?
      // Recursion needed for Array<Array<T>>
      const inner = (type as any).elementType;
      return `std::vector<${typeToCpp(inner)}>`;
    }
    case DataTypeKind.Struct: return 'Struct'; // Need generated struct name?
    default: return 'auto'; // Templates or auto
  }
}

export function generateCPP(ir: IRGraph, options: CodeGenOptions): string {
  const lines: string[] = [];

  // 1. Headers
  lines.push('#include <iostream>');
  lines.push('#include <vector>');
  lines.push('#include <string>');
  lines.push('#include <cmath>');
  lines.push('#include "json.hpp"'); // Assumes in same dir or include path
  lines.push('');
  lines.push('using json = nlohmann::json;');
  lines.push('');

  // 2. Input Struct
  lines.push('struct Input {');
  for (const [name, type] of Object.entries(options.inputs)) {
    lines.push(`    ${typeToCpp(type)} ${name};`);
  }
  lines.push('};');
  lines.push('');

  // 3. Define JSON parsing for Input (nlohmann macro)
  // NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(Input, x, y...)
  // We need to list fields.
  const inputFields = Object.keys(options.inputs).join(', ');
  if (inputFields.length > 0) {
    lines.push(`NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(Input, ${inputFields})`);
  }
  lines.push('');

  // 4. Compute Function
  // Determine return type.
  // IR often returns last statement value if expression?
  // Or assume explicit return.
  let retType = 'auto';
  if (options.outputType) retType = typeToCpp(options.outputType);

  lines.push(`${retType} compute(const Input& input) {`);

  // Logic Generation
  lines.push(emitBlock(ir.root as BlockNode, 1, options.inputs));

  lines.push('}');
  lines.push('');

  // 5. Output Struct? Or just serialization logic.
  // If we return a single value, we just output { "res": val }

  // 6. Main Harness
  lines.push(`
int main() {
    try {
        json j_in;
        std::cin >> j_in;

        Input in;
        if (j_in.contains("inputs")) {
            j_in["inputs"].get_to(in);
        } else {
             // Try root
             j_in.get_to(in);
        }

        auto res = compute(in);

        json j_out;
        j_out["outputs"] = { {"res", res} };
        std::cout << j_out.dump(4) << std::endl;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }
    return 0;
}
`);

  return lines.join('\n');
}

function emitBlock(block: BlockNode, indent: number, inputs: Record<string, DataType>): string {
  const lines: string[] = [];
  const spaces = '    '.repeat(indent);

  for (const stmt of block.statements) {
    const code = emitNode(stmt, indent, inputs); // Pass indent to emitNode
    if (code) {
      // If the code contains newlines (like for if statements),
      // we need to indent each line.
      // Otherwise, just prepend spaces.
      if (code.includes('\n')) {
        lines.push(code.split('\n').map((line, idx) => (idx === 0 ? spaces : spaces) + line).join('\n'));
      } else {
        lines.push(`${spaces}${code};`);
      }
    }
  }

  return lines.join('\n');
}

function emitNode(node: IRNode, indent: number, inputs: Record<string, DataType>): string {
  switch (node.kind) {
    case OpKind.Const: {
      const c = node as ConstNode;
      if (typeof c.value === 'string') return `"${c.value}"`;
      if (typeof c.value === 'boolean') return c.value ? 'true' : 'false';
      if (Array.isArray(c.value)) {
        // Vector initializer
        const elems = c.value.map(v => {
          if (typeof v === 'number') return String(v);
          return emitNode({ kind: OpKind.Const, value: v } as any, indent, inputs); // Recurse hack?
        }).join(', ');
        return `{ ${elems} }`;
      }
      return String(c.value);
    }
    case OpKind.Array: {
      const a = node as ArrayNode;
      const elems = a.elements.map(e => emitNode(e, indent, inputs)).join(', ');
      return `{ ${elems} }`; // std::vector initializer
    }
    case OpKind.Var: {
      const v = node as VarNode;
      if (inputs[v.name]) return `input.${v.name}`;
      return v.name;
    }
    case OpKind.Binary: {
      const b = node as BinaryNode;
      const left = emitNode(b.left, indent, inputs);
      const right = emitNode(b.right, indent, inputs);
      return `(${left} ${b.op} ${right})`;
    }
    case OpKind.Return: {
      const r = node as ReturnNode;
      return `return ${emitNode(r.value, indent, inputs)}`;
      // Note: return is a statement, not expression.
      // emitNode returns string. If statement, we add semi-colon in emitBlock.
    }
    case OpKind.Assign: {
      const a = node as AssignNode;
      return `${a.name} = ${emitNode(a.value, indent, inputs)}`;
    }
    case OpKind.VarDecl: {
      const d = node as VarDeclNode;
      let init = '';
      if (d.init) init = ` = ${emitNode(d.init, indent, inputs)}`;
      return `${typeToCpp(d.type as any || { kind: DataTypeKind.Primitive, name: 'number' })} ${d.name}${init}`;
    }
    case OpKind.If: {
      const i = node as IfNode;
      const cond = emitNode(i.condition, indent, inputs);
      const thenB = emitBlock(i.thenBlock, indent + 1, inputs);
      let res = `if (${cond}) {\n${thenB}\n${'    '.repeat(indent)}}`;
      if (i.elseBlock) {
        const elseB = emitBlock(i.elseBlock, indent + 1, inputs);
        res += ` else {\n${elseB}\n${'    '.repeat(indent)}}`;
      }
      return res;
    }
    case OpKind.Intrinsic: {
      const i = node as IntrinsicNode;
      if (i.library === 'Math') {
        // Map Math.sin -> std::sin
        const args = i.args.map(a => emitNode(a, indent, inputs)).join(', ');
        return `std::${i.method}(${args})`;
      }
      // Array intrinsics?
      if (i.library === 'Array' && i.method === 'push') {
        // args[0] is array? No, push is method on array.
        // Actually stdlib defines `args` as arguments list.
        // push implementation in stdlib takes (ctx, call, args, obj).
        // IntrinsicNode might need 'object'?
        // Our IntrinsicNode def has `args`. Does it include `this`?
        // In compiler.ts, IntrinsicNode usually stores flattened args.
        // Let's check Array.get in IntrinsicNode.
      }
      return `/* Unknown Intrinsic: ${i.library}.${i.method} */`;
    }
    case OpKind.PropAccess: {
      const p = node as PropAccessNode;
      return `${emitNode(p.object, indent, inputs)}.${p.property}`;
    }
    case OpKind.IndexAccess: {
      const p = node as any; // IndexAccessNode
      return `${emitNode(p.object, indent, inputs)}[${emitNode(p.index, indent, inputs)}]`;
    }
  }
  return `/* Unknown Op: ${node.kind} */`;
}
