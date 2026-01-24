import {
  DataType, DataTypeKind, PrimitiveType, UnionType, LiteralType, StructType
} from './ir-types';

export class TypeChecker {

  // Checks if 'source' can be assigned to 'target'
  static isAssignableTo(source: DataType, target: DataType): boolean {
    if (source.kind === DataTypeKind.Any || target.kind === DataTypeKind.Any) return true;
    if (source === target) return true; // Ref equality check

    // 1. Literal -> Primitive (e.g., 5 -> number)
    if (source.kind === DataTypeKind.Literal && target.kind === DataTypeKind.Primitive) {
      return (source as LiteralType).baseType.name === (target as PrimitiveType).name;
    }

    // 2. Union Handling
    if (target.kind === DataTypeKind.Union) {
      return (target as UnionType).types.some(t => this.isAssignableTo(source, t));
    }

    // If source is Union, ALL members must be assignable to target
    if (source.kind === DataTypeKind.Union) {
      return (source as UnionType).types.every(t => this.isAssignableTo(t, target));
    }

    // 3. Primitives
    if (source.kind === DataTypeKind.Primitive && target.kind === DataTypeKind.Primitive) {
      return (source as PrimitiveType).name === (target as PrimitiveType).name;
    }

    // 4. Structs (Structural Typing)
    if (source.kind === DataTypeKind.Struct && target.kind === DataTypeKind.Struct) {
      const s = source as StructType;
      const t = target as StructType;
      // Target fields must exist in Source and match types
      for (const key in t.fields) {
        if (!s.fields[key]) return false;
        if (!this.isAssignableTo(s.fields[key], t.fields[key])) return false;
      }
      return true;
    }

    // Default failure
    return false;
  }

  // Merges types into a Union or simplifies them
  static unify(types: DataType[]): DataType {
    const uniqueTypes: DataType[] = [];

    // Flatten nested unions and filter duplicates
    const process = (t: DataType) => {
      if (t.kind === DataTypeKind.Union) {
        (t as UnionType).types.forEach(process);
      } else {
        // Simple weak dedupe for Primitives
        const exists = uniqueTypes.some(u => this.isSameType(u, t));
        if (!exists) uniqueTypes.push(t);
      }
    };

    types.forEach(process);

    if (uniqueTypes.length === 0) return { kind: DataTypeKind.Primitive, name: 'void' } as PrimitiveType;
    if (uniqueTypes.length === 1) return uniqueTypes[0];

    return { kind: DataTypeKind.Union, types: uniqueTypes } as UnionType;
  }

  static isSameType(a: DataType, b: DataType): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === DataTypeKind.Primitive) return (a as PrimitiveType).name === (b as PrimitiveType).name;
    if (a.kind === DataTypeKind.Literal) return (a as LiteralType).value === (b as LiteralType).value;
    return false; // Conservative
  }

  // Narrows a type based on a condition (e.g. Type Guard)
  // For 'typeof x === "string"', checkKind='typeof', checkValue='string'
  static narrow(source: DataType, checkKind: 'typeof' | 'instanceof', checkValue: string): DataType {
    if (source.kind === DataTypeKind.Union) {
      // Filter the parts of the union that match the guard
      const matchingTypes = (source as UnionType).types.filter(t => {
        if (checkKind === 'typeof') {
          // Map TS typeof strings to our Types
          if (checkValue === 'number' && t.kind === DataTypeKind.Primitive && (t as PrimitiveType).name === 'number') return true;
          if (checkValue === 'string' && t.kind === DataTypeKind.Primitive && (t as PrimitiveType).name === 'string') return true;
          if (checkValue === 'number' && t.kind === DataTypeKind.Literal && (t as LiteralType).baseType.name === 'number') return true;
          return false;
        }
        return true;
      });

      if (matchingTypes.length === 0) return { kind: DataTypeKind.Primitive, name: 'void' } as PrimitiveType;
      if (matchingTypes.length === 1) return matchingTypes[0];
      return { kind: DataTypeKind.Union, types: matchingTypes } as UnionType;
    }

    // Narrowing a primitive?
    if (checkKind === 'typeof') {
      if (checkValue === 'number') {
        if (this.isAssignableTo(source, { kind: DataTypeKind.Primitive, name: 'number' } as PrimitiveType)) return source;
      }
    }

    return { kind: DataTypeKind.Primitive, name: 'void' } as PrimitiveType; // Should be Never
  }

  // Substitutes generic placeholders with concrete types
  // e.g. T -> number
  // genericName: optional name of the generic type being substituted (for reflection)
  static substitute(type: DataType, map: Map<string, DataType>, genericName?: string): DataType {
    // Helper to extract plain object from Map for the record
    const getParams = (): Record<string, DataType> => {
      const rec: Record<string, DataType> = {};
      map.forEach((v, k) => rec[k] = v);
      return rec;
    };

    if (type.kind === DataTypeKind.Generic) {
      const name = (type as any).name;
      if (map.has(name)) return map.get(name)!;
      return type;
    }

    if (type.kind === DataTypeKind.Union) {
      return {
        kind: DataTypeKind.Union,
        types: (type as UnionType).types.map(t => this.substitute(t, map))
      } as UnionType;
    }

    if (type.kind === DataTypeKind.Struct) {
      const st = type as StructType;
      const newFields: Record<string, DataType> = {};
      for (const key in st.fields) {
        newFields[key] = this.substitute(st.fields[key], map);
      }

      const result: StructType = { ...st, fields: newFields };

      // Attach reflection info if this substitution corresponds to a named generic type
      if (genericName) {
        result.generic = {
          base: genericName,
          params: getParams()
        };
      }
      return result;
    }

    // Array, Tuple, etc. should also be handled recursively
    if (type.kind === DataTypeKind.Array) {
      const res = { ...type, elementType: this.substitute((type as any).elementType, map) } as any;
      if (genericName) {
        res.generic = { base: genericName, params: getParams() };
      }
      return res;
    }

    return type;
  }
}
