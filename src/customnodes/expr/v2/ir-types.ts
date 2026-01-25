// Expr V2 Intermediate Representation

export type TypeId = string; // e.g., 'number', 'float4', 'struct:Vector2'

export enum DataTypeKind {
  Primitive = 'primitive',
  Struct = 'struct',
  Array = 'array',
  Union = 'union',
  Literal = 'literal',
  Tuple = 'tuple',
  Function = 'function',
  Generic = 'generic',
  GenericInstantiation = 'generic_instantiation',
  Any = 'any', // For transition/error states
}


export interface BaseDataType {
  kind: DataTypeKind;
}

export interface PrimitiveType extends BaseDataType {
  kind: DataTypeKind.Primitive;
  name: 'number' | 'boolean' | 'string' | 'void' | 'null' | 'undefined';
}

export interface LiteralType extends BaseDataType {
  kind: DataTypeKind.Literal;
  baseType: PrimitiveType;
  value: number | boolean | string;
}

export interface UnionType extends BaseDataType {
  kind: DataTypeKind.Union;
  types: DataType[];
}

export interface GenericInstantiation {
  base: string; // Name of the original generic type (e.g., 'Vector')
  params: Record<string, DataType>; // Map of param name to concrete type (e.g. { T: number })
}

export interface StructType extends BaseDataType {
  kind: DataTypeKind.Struct;
  name?: string; // Optional name
  fields: Record<string, DataType>;
  generic?: GenericInstantiation;
}

export interface ArrayType extends BaseDataType {
  kind: DataTypeKind.Array;
  elementType: DataType;
  length?: number; // If static
  generic?: GenericInstantiation;
}

export interface TupleType extends BaseDataType {
  kind: DataTypeKind.Tuple;
  elements: DataType[];
  generic?: GenericInstantiation;
}

export interface FunctionType extends BaseDataType {
  kind: DataTypeKind.Function;
  signature: string; // Placeholder for now
  generic?: GenericInstantiation;
}

export interface GenericType extends BaseDataType {
  kind: DataTypeKind.Generic;
  name: string; // 'T'
  constraint?: DataType;
}

export interface AnyType extends BaseDataType {
  kind: DataTypeKind.Any;
}

export type DataType = PrimitiveType | LiteralType | UnionType | StructType | ArrayType | TupleType | FunctionType | GenericType | AnyType;


// --- IR Ops ---

export enum OpKind {
  Const = 'const',
  Binary = 'binary',
  Unary = 'unary',
  Var = 'var',
  Assign = 'assign',
  Block = 'block',
  If = 'if',
  Return = 'return',
  VarDecl = 'var_decl',
  Array = 'array',
  Struct = 'struct',
  PropAccess = 'prop_access',
  IndexAccess = 'index_access',
  Phi = 'phi',
  Intrinsic = 'intrinsic'
}

export interface IRNode {
  id: string;
  kind: OpKind;
  type: DataType;
  debugInfo?: { line: number };
}

export interface ConstNode extends IRNode {
  kind: OpKind.Const;
  value: any;
}

export interface IntrinsicNode extends IRNode {
  kind: OpKind.Intrinsic;
  library: string; // e.g. 'Math'
  method: string;  // e.g. 'sin'
  args: IRNode[];
}

export interface BinaryNode extends IRNode {
  kind: OpKind.Binary;
  op: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>=';
  left: IRNode;
  right: IRNode;
}

export interface IfNode extends IRNode {
  kind: OpKind.If;
  condition: IRNode;
  thenBlock: BlockNode;
  elseBlock?: BlockNode;
}

export interface BlockNode extends IRNode {
  kind: OpKind.Block;
  statements: IRNode[];
}

export interface ReturnNode extends IRNode {
  kind: OpKind.Return;
  value: IRNode;
}


export interface VarNode extends IRNode {
  kind: OpKind.Var;
  name: string;
}

export interface UnaryNode extends IRNode {
  kind: OpKind.Unary;
  op: '-' | '!' | '~';
  operand: IRNode;
}
export interface AssignNode extends IRNode {
  kind: OpKind.Assign;
  target: string;
  value: IRNode;
}

export interface ArrayNode extends IRNode {
  kind: OpKind.Array;
  elements: IRNode[];
}

export interface StructNode extends IRNode {
  kind: OpKind.Struct;
  fields: Record<string, IRNode>;
}

export interface PropAccessNode extends IRNode {
  kind: OpKind.PropAccess;
  object: IRNode;
  property: string;
}

export interface IndexAccessNode extends IRNode {
  kind: OpKind.IndexAccess;
  object: IRNode;
  index: IRNode;
}

export interface PhiNode extends IRNode {
  kind: OpKind.Phi;
  condition: IRNode;
  trueValue: IRNode;
  falseValue: IRNode;
}

export interface VarDeclNode extends IRNode {
  kind: OpKind.VarDecl;
  name: string;
  init?: IRNode;
}

export interface IRGraph {
  root: IRNode;
}
