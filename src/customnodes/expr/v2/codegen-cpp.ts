import { IRGraph, IRNode, OpKind, DataType, DataTypeKind, BlockNode, IfNode, BinaryNode, ConstNode, VarNode, VarDeclNode, AssignNode, ReturnNode, IntrinsicNode, ArrayNode, StructNode, PropAccessNode, PrimitiveType, IndexAccessNode, StructType, PhiNode, UnaryNode, WhileNode, BreakNode, SetPropNode, SetIndexNode } from './ir-types';

export interface CodeGenOptions {
  inputs: Record<string, DataType>; // Map of input names to types
  outputType?: DataType; // Expected output type (or inferred)
  debug?: boolean; // Enable debug source map logging
}

// Helper to generate canonical name for structural types
function getStructName(type: StructType): string {
  if (type.name) return type.name;
  // Canonical name based on sorted fields
  const keys = Object.keys(type.fields).sort();
  return `Struct_${keys.join('_')}`;
}

function collectStructs(ir: IRGraph, inputs: Record<string, DataType>): Map<string, StructType> {
  const structs = new Map<string, StructType>();

  function visitType(t: DataType) {
    if (!t) return;
    if (t.kind === DataTypeKind.Struct) {
      const s = t as StructType;
      const name = getStructName(s);
      if (!structs.has(name)) {
        structs.set(name, s);
        // visit fields
        Object.values(s.fields).forEach(visitType);
      }
    } else if (t.kind === DataTypeKind.Array) {
      visitType((t as any).elementType);
    }
  }

  // scans inputs
  Object.values(inputs).forEach(visitType);

  // scan nodes
  function visitNode(n: IRNode) {
    if (n.type) visitType(n.type);
    if (n.kind === OpKind.Block) {
      (n as BlockNode).statements.forEach(visitNode);
    }
    if (n.kind === OpKind.If) {
      visitNode((n as IfNode).condition);
      visitNode((n as IfNode).thenBlock);
      if ((n as IfNode).elseBlock) visitNode((n as IfNode).elseBlock!);
    }
    // ... recursing all usage ...
    // Simplification: just scan flat list of nodes if we traverse block?
    // But what about nested expressions? emitNode recurses.
    // We need deep traversal.
    // Let's assume types are captured on nodes.
  }
  // We need a proper traverse function or just rely on inputs + declarations?
  // Constants might imply struct types.
  // Let's iterate all reachable nodes.
  const visited = new Set<string>();
  const stack = [ir.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (!n || typeof n !== 'object') continue; // Defensive
    // if (visited.has((n as any).id)) continue; // Nodes might not have IDs? IRNode has id.
    // visited.add((n as any).id);

    if ((n as any).type) visitType((n as any).type);

    // Push children
    if (n.kind === OpKind.Block) stack.push(...(n as BlockNode).statements);
    else if (n.kind === OpKind.If) {
      stack.push((n as IfNode).condition);
      stack.push((n as IfNode).thenBlock);
      if ((n as IfNode).elseBlock) stack.push((n as IfNode).elseBlock!);
    }
    else if (n.kind === OpKind.Binary) { stack.push((n as BinaryNode).left, (n as BinaryNode).right); }
    else if (n.kind === OpKind.Assign) { stack.push((n as AssignNode).value); }
    else if (n.kind === OpKind.Return) { stack.push((n as ReturnNode).value); }
    else if (n.kind === OpKind.Struct) {
      const s = n as StructNode;
      Object.values(s.fields).forEach(f => stack.push(f));
    }
    else if (n.kind === OpKind.Array) { stack.push(...(n as ArrayNode).elements); }
    else if (n.kind === OpKind.PropAccess) { stack.push((n as PropAccessNode).object); }
    else if (n.kind === OpKind.IndexAccess) { stack.push((n as any).object, (n as any).index); }
    else if (n.kind === OpKind.Intrinsic) { stack.push(...(n as IntrinsicNode).args); }
    else if (n.kind === OpKind.VarDecl) { if ((n as VarDeclNode).init) stack.push((n as VarDeclNode).init!); }

  }

  return structs;
}

// Garbage removed

// Need to allow typeToCpp to be replaced or modified
// We can shadow it or pass struct map.
// Simpler: Just rely on getStructName in typeToCpp if we export it or use the new one locally?

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
      const inner = (type as any).elementType;
      return `std::vector<${typeToCpp(inner)}>`;
    }
    case DataTypeKind.Struct: return getStructName(type as any);
    case DataTypeKind.Union: {
      const u = type as any;
      const nonNull = u.types.filter((sub: DataType) =>
        !(sub.kind === DataTypeKind.Primitive && (sub.name === 'null' || sub.name === 'undefined'))
      );
      if (nonNull.length === 1) {
        return `std::optional<${typeToCpp(nonNull[0])}>`;
      }
      if (nonNull.length === 0) {
        // Pure null/undefined
        return `std::optional<double>`;
      }
      throw new Error(`Complex unions not supported in C++ backend: ${JSON.stringify(type)}`);
    }
    default: return 'auto';
  }
}

export function generateCPP(ir: IRGraph, options: CodeGenOptions): string {
  const lines: string[] = [];

  // Collect Structs
  const structs = collectStructs(ir, options.inputs);

  // 1. Headers
  lines.push('#include <iostream>');
  lines.push('#include <vector>');
  lines.push('#include <string>');
  lines.push('#include <cmath>');
  lines.push('#include <algorithm>');
  lines.push('#include <optional>');
  lines.push('#include "json.hpp"');
  lines.push('');
  lines.push('using json = nlohmann::json;');
  lines.push('');

  // 1.5 Emit Struct Defs


  // 2. Input Struct
  // 3. Define Types and Serialization
  structs.forEach((structType, name) => {
    lines.push(`struct ${name} {`);
    for (const [fname, ftype] of Object.entries(structType.fields)) {
      lines.push(`    ${typeToCpp(ftype)} ${fname}{};`);
    }
    lines.push('};');
    lines.push(`void to_json(json& j, const ${name}& p) {`);
    lines.push('    j = json{');
    const fieldNames = Object.keys(structType.fields);
    lines.push(fieldNames.map(f => `        {"${f}", p.${f}}`).join(',\n'));
    lines.push('    };');
    lines.push('}');
    lines.push(`void from_json(const json& j, ${name}& p) {`);
    for (const [fname, ftype] of Object.entries(structType.fields)) {
      // partial check for optional
      // If type string starts with std::optional...
      const cppTypeStr = typeToCpp(ftype);
      if (cppTypeStr.startsWith('std::optional')) {
        lines.push(`    if (j.contains("${fname}")) j.at("${fname}").get_to(p.${fname});`);
      } else {
        lines.push(`    j.at("${fname}").get_to(p.${fname});`);
      }
    }
    lines.push('}');
    lines.push('');
  });

  // Input Struct
  lines.push('struct Input {');
  for (const [name, type] of Object.entries(options.inputs)) {
    lines.push(`    ${typeToCpp(type)} ${name}{};`);
  }
  lines.push('};');

  lines.push('void from_json(const json& j, Input& p) {');
  for (const [name, type] of Object.entries(options.inputs)) {
    const cppTypeStr = typeToCpp(type);
    if (cppTypeStr.startsWith('std::optional')) {
      lines.push(`    if (j.contains("${name}")) j.at("${name}").get_to(p.${name});`);
    } else {
      lines.push(`    if (j.contains("${name}")) j.at("${name}").get_to(p.${name});`); // Inputs might be optional in root?
      // Actually if root input is missing but required, we throw?
      // Standard get_to throws.
    }
  }
  lines.push('}');
  lines.push('');

  // 4. Compute Function
  let retType = 'auto';
  if (options.outputType) retType = typeToCpp(options.outputType);

  // Debug Scaffolding
  if (options.debug) {
    lines.push('json debug_log = json::object();');
    lines.push('template <typename T> auto to_debug_json(const T& v) { return v; }');
    lines.push('template <typename T> auto to_debug_json(const std::vector<T>& v) {');
    lines.push('    if (v.size() > 4) return std::vector<T>(v.begin(), v.begin() + 4);');
    lines.push('    return v;');
    lines.push('}');
    lines.push('template <typename T> void record_debug(int line, const T& val) {');
    lines.push('    debug_log[std::to_string(line)] = to_debug_json(val);');
    lines.push('}');
  }

  lines.push(`${retType} compute(const Input& input) {`);
  // Pass debug option recursively? Or global flag?
  // emitNode needs access to 'options.debug'.
  // I must pass options or 'debug' boolean to emitBlock/emitNode.
  // Currently emitBlock takes (block, indent, inputs).
  // I need to refactor emitBlock signature or bind it.
  // I'll update emitBlock signature below.
  lines.push(emitBlock(ir.root as BlockNode, 1, options));
  lines.push('}');
  lines.push('');

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
`);
  if (options.debug) {
    lines.push('        j_out["debug"] = debug_log;');
  }
  lines.push(`        std::cout << j_out.dump(4) << std::endl;`);

  lines.push(`
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }
    return 0;
}
`);

  return lines.join('\n');
}


function emitBlock(block: BlockNode, indent: number, options: CodeGenOptions): string {
  const lines: string[] = [];
  const spaces = '    '.repeat(indent);

  for (const stmt of block.statements) {
    const code = emitNode(stmt, indent, options);
    if (code) {
      if (stmt.kind === OpKind.If || stmt.kind === OpKind.Block || stmt.kind === OpKind.VarDecl || stmt.kind === OpKind.While) {
        if (options.debug && stmt.kind === OpKind.VarDecl) {
          lines.push(`${spaces}${code}; `);
          const d = stmt as VarDeclNode;
          if (d.debugInfo) lines.push(`${spaces} record_debug(${d.debugInfo.line}, ${d.name}); `);
        } else {
          lines.push(code.includes('\n') ? code.split('\n').map((line, idx) => (idx === 0 ? spaces : spaces) + line).join('\n') : `${spaces}${code}${stmt.kind === OpKind.VarDecl ? ';' : ''} `);
          // If VarDecl (not block/if), it needs semicolon if not provided?
          // Actually my prev logic was: `lines.push((stmt.kind === OpKind.If || OpKind.Block) ? code : `${spaces}${code};`); `
          // VarDecl emits `type name = val`. It needs semicolon.
          // If statement had logic: if (If/Block) push(code) else push(`${ code }; `).
          // So VarDecl fell into `else `?
          // Checking prev code line 280: `lines.push(`${spaces}${code}; `); `
          // So VarDecl was in the semicolon bucket.
          // But my "ReplacementContent" logic for `If` check was: `stmt.kind === OpKind.If || stmt.kind === OpKind.Block || stmt.kind === OpKind.VarDecl`.
          // If I put VarDecl in the "no semicolon added" bucket, I must ensure `emitNode` adds it OR `emitBlock` logic handles it manually.
          // Best to keep standard logic:
          // If Block/If: code covers it.
          // Else: append ;
        }
      } else {
        // Assign, Return, Expr
        if (code.includes('\n')) { // e.g. multi-line struct init?
          lines.push(code.split('\n').map((line, idx) => (idx === 0 ? spaces : spaces) + line).join('\n') + ';');
        } else {
          lines.push(`${spaces}${code}; `);
        }
        // Debug logic for Assign
        if (options.debug && stmt.kind === OpKind.Assign) {
          const a = stmt as AssignNode;
          if (a.debugInfo) lines.push(`${spaces} record_debug(${a.debugInfo.line}, ${a.target}); `);
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
      if (c.value === null || c.value === undefined) return 'std::nullopt';
      if (typeof c.value === 'string') return `"${c.value}"`;
      if (typeof c.value === 'boolean') return c.value ? 'true' : 'false';
      if (Array.isArray(c.value)) {
        let elemType: DataType | undefined = undefined;
        if (c.type && c.type.kind === DataTypeKind.Array) {
          elemType = (c.type as any).elementType;
        }
        const elems = c.value.map((v: any) => {
          if (typeof v === 'number') {
            const s = String(v);
            return s.includes('.') ? s : s + '.0';
          }
          return emitNode({ kind: OpKind.Const, type: elemType, value: v } as any, indent, options);
        }).join(', ');
        return `{ ${elems} } `;
      }
      if (typeof c.value === 'object' && c.value && !Array.isArray(c.value)) {
        if (c.type.kind === DataTypeKind.Struct) {
          const sType = c.type as StructType;
          const name = getStructName(sType);
          const keys = Object.keys(sType.fields).sort();
          // Value is a JS object { r: 0, i: 0 }
          const valObj = c.value as any;
          const args = keys.map(k => {
            // We need to emit the field value.
            // Recursively emit const?
            // Helper: typeToCpp(valObj[k])? No, we need value string.
            // We can synthesize a ConstNode?
            // Or simple recursion if we assume primitives?
            // Let's use emitNode with a synthetic ConstNode used for recursion.
            // NOTE: We need correct type for the field.
            // Field type is in sType.fields[k].
            return emitNode({
              kind: OpKind.Const,
              type: sType.fields[k],
              value: valObj[k],
              id: 'const_inner'
            } as any, indent, options);
          }).join(', ');
          return `${name}{${args}}`;
        }
        return '/* unused_function */ 0';
      }
      if (typeof c.value === 'number') {
        const s = String(c.value);
        return s.includes('.') ? s : s + '.0';
      }
      return String(c.value);
    }
    case OpKind.Array: {
      const a = node as ArrayNode;
      const elems = a.elements.map(e => emitNode(e, indent, options)).join(', ');
      return `{ ${elems} } `;
    }
    case OpKind.Var: {
      const v = node as VarNode;
      if (inputs[v.name]) return `input.${v.name} `;
      return v.name;
    }
    case OpKind.Binary: {
      const b = node as BinaryNode;
      const left = emitNode(b.left, indent, options);
      const right = emitNode(b.right, indent, options);
      return `(${left} ${b.op} ${right})`;
    }
    case OpKind.Return: {
      const r = node as ReturnNode;
      return `return ${emitNode(r.value, indent, options)} `;
    }
    case OpKind.Assign: {
      const a = node as AssignNode;
      return `${a.target} = ${emitNode(a.value, indent, options)} `;
    }
    case OpKind.VarDecl: {
      const d = node as VarDeclNode;
      let init = '';
      if (d.init) init = ` = ${emitNode(d.init, indent, options)} `;
      return `${typeToCpp(d.type || NUMBER_TYPE)} ${d.name}${init} `;
    }
    case OpKind.If: {
      const i = node as IfNode;
      const cond = emitNode(i.condition, indent, options);
      const thenB = emitBlock(i.thenBlock, indent + 1, options);
      let res = `if (${cond}) { \n${thenB} \n${'    '.repeat(indent)} } `;
      if (i.elseBlock) {
        const elseB = emitBlock(i.elseBlock, indent + 1, options);
        res += ` else { \n${elseB} \n${'    '.repeat(indent)} } `;
      }
      return res;
    }
    case OpKind.Unary: {
      const u = node as UnaryNode;
      const operand = emitNode(u.operand, indent, options);
      return `(${u.op}${operand})`;
    }
    case OpKind.Phi: {
      const p = node as PhiNode;
      const cond = emitNode(p.condition, indent, options);
      const tVal = emitNode(p.trueValue, indent, options);
      const fVal = emitNode(p.falseValue, indent, options);
      return `((${cond}) ? (${tVal}) : (${fVal}))`;
    }
    case OpKind.While: {
      const w = node as WhileNode;
      const cond = emitNode(w.condition, indent, options);
      const body = emitBlock(w.body, indent + 1, options);
      return `while (${cond}) {\n${body}\n${'    '.repeat(indent)}}`;
    }
    case OpKind.Break: return 'break';
    case OpKind.Intrinsic: {
      const i = node as IntrinsicNode;
      // ... Intrinsic Helper needs recursion ...
      // I'll inline the simple map logic for brevity in replace
      const simpleMaps: Record<string, string> = {
        'sin': 'std::sin', 'cos': 'std::cos', 'tan': 'std::tan',
        'abs': 'std::abs', 'sqrt': 'std::sqrt', 'log': 'std::log',
        'exp': 'std::exp', 'floor': 'std::floor', 'ceil': 'std::ceil', 'round': 'std::round'
      };
      if (simpleMaps[i.method]) {
        return `${simpleMaps[i.method]} (${emitNode(i.args[0], indent, options)})`;
      }
      if (i.method === 'pow') return `std:: pow(${emitNode(i.args[0], indent, options)}, ${emitNode(i.args[1], indent, options)})`;
      if (i.method === 'min') return `std:: min(${emitNode(i.args[0], indent, options)}, ${emitNode(i.args[1], indent, options)})`;
      if (i.method === 'max') return `std:: max(${emitNode(i.args[0], indent, options)}, ${emitNode(i.args[1], indent, options)})`;
      return `/* Unknown Intrinsic */`;
    }
    case OpKind.Struct: {
      const s = node as StructNode;
      const name = getStructName(s.type as StructType);
      const keys = Object.keys(s.fields).sort();
      const args = keys.map(k => emitNode(s.fields[k], indent, options)).join(', ');
      return `${name} {${args} } `;
    }
    case OpKind.PropAccess: {
      const p = node as PropAccessNode;
      return `${emitNode(p.object, indent, options)}.${p.property} `;
    }
    case OpKind.SetProp: {
      const sp = node as SetPropNode;
      return `${emitNode(sp.object, indent, options)}.${sp.property} = ${emitNode(sp.value, indent, options)} `;
    }
    case OpKind.SetIndex: {
      const si = node as SetIndexNode;
      return `${emitNode(si.object, indent, options)}[${emitNode(si.index, indent, options)}] = ${emitNode(si.value, indent, options)} `;
    }
    case OpKind.IndexAccess: {
      const p = node as any;
      return `${emitNode(p.object, indent, options)} [${emitNode(p.index, indent, options)}]`;
    }
    default:
      return `/* Unknown Op: ${node.kind} */`;
  }
}
