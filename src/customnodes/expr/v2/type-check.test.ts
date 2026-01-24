import { describe, it, expect } from 'vitest';
import { TypeChecker } from './type-check';
import { DataTypeKind, PrimitiveType, LiteralType, StructType } from './ir-types';

// Helpers
const NUMBER: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };
const STRING: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'string' };
const LITERAL_5: LiteralType = { kind: DataTypeKind.Literal, baseType: NUMBER, value: 5 };

describe('TypeChecker', () => {
  describe('isAssignableTo', () => {
    it('should allow exact primitive matches', () => {
      expect(TypeChecker.isAssignableTo(NUMBER, NUMBER)).toBe(true);
      expect(TypeChecker.isAssignableTo(NUMBER, STRING)).toBe(false);
    });

    it('should allow literal to primitive', () => {
      expect(TypeChecker.isAssignableTo(LITERAL_5, NUMBER)).toBe(true);
      expect(TypeChecker.isAssignableTo(LITERAL_5, STRING)).toBe(false);
    });

    it('should handle struct compatibility', () => {
      const Point2D: StructType = { kind: DataTypeKind.Struct, fields: { x: NUMBER, y: NUMBER } };
      const Point3D: StructType = { kind: DataTypeKind.Struct, fields: { x: NUMBER, y: NUMBER, z: NUMBER } };

      // Point3D has all fields of Point2D -> It IS assignable to Point2D
      expect(TypeChecker.isAssignableTo(Point3D, Point2D)).toBe(true);

      // Point2D is missing 'z' -> NOT assignable to Point3D
      expect(TypeChecker.isAssignableTo(Point2D, Point3D)).toBe(false);
    });
  });

  describe('unify', () => {
    it('should collapse identical primitives', () => {
      const unified = TypeChecker.unify([NUMBER, NUMBER]);
      expect(unified.kind).toBe(DataTypeKind.Primitive);
      expect((unified as PrimitiveType).name).toBe('number');
    });

    it('should create union for distinct primitives', () => {
      const unified = TypeChecker.unify([NUMBER, STRING]);
      expect(unified.kind).toBe(DataTypeKind.Union);
      expect((unified as any).types).toHaveLength(2);
    });
  });

  describe('narrow', () => {
    const UNION = TypeChecker.unify([NUMBER, STRING]);

    it('should narrow union to primitive', () => {
      const narrowed = TypeChecker.narrow(UNION, 'typeof', 'number');
      expect(narrowed.kind).toBe(DataTypeKind.Primitive);
      expect((narrowed as PrimitiveType).name).toBe('number');
    });

    it('should return void/never if no match', () => {
      const narrowed = TypeChecker.narrow(STRING, 'typeof', 'number');
      expect(narrowed.kind).toBe(DataTypeKind.Primitive);
      expect((narrowed as PrimitiveType).name).toBe('void');
    });
  });

  describe('generics', () => {
    it('should substitute generic parameter and attach reflection info', () => {
      const T: any = { kind: DataTypeKind.Generic, name: 'T' };
      const StructWithT: StructType = { kind: DataTypeKind.Struct, fields: { val: T } };

      const map = new Map<string, any>();
      map.set('T', NUMBER);

      const Concrete = TypeChecker.substitute(StructWithT, map, 'MyWrapper') as StructType;
      expect(Concrete.fields.val.kind).toBe(DataTypeKind.Primitive);
      expect((Concrete.fields.val as PrimitiveType).name).toBe('number');

      // Check reflection info
      expect(Concrete.generic).toBeDefined();
      expect(Concrete.generic?.base).toBe('MyWrapper');
      expect((Concrete.generic?.params['T'] as PrimitiveType).name).toBe('number');
    });
  });
});
