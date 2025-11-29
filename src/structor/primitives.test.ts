import { expect } from '@open-wc/testing';
import {
  primitive_subtract, primitive_multiply, primitive_divide, primitive_pow, primitive_min, primitive_max,
  primitive_abs, primitive_negate, primitive_ceil, primitive_floor, primitive_round, primitive_sin, primitive_cos, primitive_tan, primitive_sqrt,
  primitive_and, primitive_or, primitive_xor, primitive_equals, primitive_greater_than, primitive_less_than, primitive_not,
  primitive_pi, primitive_e
} from './primitives';
import { ExecutionContext } from './structor';

describe('Primitive Nodes', () => {
  // Mock context with simple broadcast that passes through values
  // Since we are testing with scalar numbers, we can just wrap them in the expected structure
  const context = {
    broadcast: (config: any, input: any) => {
      // Simplified broadcast mock for scalar inputs
      // definePrimitiveNode uses reduce: 'first' for atomic types, so we should return the value directly
      const fields: any = {};
      for (const key of Object.keys(input.fields)) {
        fields[key] = input.fields[key];
      }
      return { fields, untagged: [] };
    },
    nodeState: new Map()
  } as unknown as ExecutionContext;

  const executeBinary = (node: any, a: number, b: number) => {
    // The helper expects StructorRecord input
    const result = node.execute({ fields: { a, b }, untagged: [] }, {}, context);
    return result.fields.result;
  };

  const executeUnary = (node: any, a: number) => {
    const result = node.execute({ fields: { a }, untagged: [] }, {}, context);
    return result.fields.result;
  };

  describe('Math (Constants)', () => {
    it('math.pi', () => {
      expect(primitive_pi.execute({}, {}, context).fields.result).to.be.closeTo(Math.PI, 0.0001);
    });
    it('math.e', () => {
      expect(primitive_e.execute({}, {}, context).fields.result).to.be.closeTo(Math.E, 0.0001);
    });
  });

  describe('Math (Binary)', () => {
    it('math.subtract', () => {
      expect(executeBinary(primitive_subtract, 10, 3)).to.equal(7);
    });
    it('math.multiply', () => {
      expect(executeBinary(primitive_multiply, 4, 3)).to.equal(12);
    });
    it('math.divide', () => {
      expect(executeBinary(primitive_divide, 10, 2)).to.equal(5);
    });
    it('math.pow', () => {
      expect(executeBinary(primitive_pow, 2, 3)).to.equal(8);
    });
    it('math.min', () => {
      expect(executeBinary(primitive_min, 5, 10)).to.equal(5);
    });
    it('math.max', () => {
      expect(executeBinary(primitive_max, 5, 10)).to.equal(10);
    });
  });

  describe('Math (Unary)', () => {
    it('math.abs', () => {
      expect(executeUnary(primitive_abs, -5)).to.equal(5);
    });
    it('math.negate', () => {
      expect(executeUnary(primitive_negate, 5)).to.equal(-5);
    });
    it('math.ceil', () => {
      expect(executeUnary(primitive_ceil, 4.2)).to.equal(5);
    });
    it('math.floor', () => {
      expect(executeUnary(primitive_floor, 4.8)).to.equal(4);
    });
    it('math.round', () => {
      expect(executeUnary(primitive_round, 4.5)).to.equal(5);
      expect(executeUnary(primitive_round, 4.4)).to.equal(4);
    });
    it('math.sin', () => {
      expect(executeUnary(primitive_sin, Math.PI / 2)).to.be.closeTo(1, 0.0001);
    });
    it('math.cos', () => {
      expect(executeUnary(primitive_cos, 0)).to.equal(1);
    });
    it('math.tan', () => {
      expect(executeUnary(primitive_tan, 0)).to.equal(0);
    });
    it('math.sqrt', () => {
      expect(executeUnary(primitive_sqrt, 16)).to.equal(4);
    });
  });

  describe('Logic (Binary)', () => {
    it('logic.and', () => {
      expect(executeBinary(primitive_and, 1, 1)).to.equal(1);
      expect(executeBinary(primitive_and, 1, 0)).to.equal(0);
      expect(executeBinary(primitive_and, 0, 1)).to.equal(0);
      expect(executeBinary(primitive_and, 0, 0)).to.equal(0);
    });
    it('logic.or', () => {
      expect(executeBinary(primitive_or, 1, 1)).to.equal(1);
      expect(executeBinary(primitive_or, 1, 0)).to.equal(1);
      expect(executeBinary(primitive_or, 0, 1)).to.equal(1);
      expect(executeBinary(primitive_or, 0, 0)).to.equal(0);
    });
    it('logic.xor', () => {
      expect(executeBinary(primitive_xor, 1, 1)).to.equal(0);
      expect(executeBinary(primitive_xor, 1, 0)).to.equal(1);
      expect(executeBinary(primitive_xor, 0, 1)).to.equal(1);
      expect(executeBinary(primitive_xor, 0, 0)).to.equal(0);
    });
    it('logic.equals', () => {
      expect(executeBinary(primitive_equals, 5, 5)).to.equal(1);
      expect(executeBinary(primitive_equals, 5, 6)).to.equal(0);
    });
    it('logic.greater_than', () => {
      expect(executeBinary(primitive_greater_than, 5, 3)).to.equal(1);
      expect(executeBinary(primitive_greater_than, 3, 5)).to.equal(0);
    });
    it('logic.less_than', () => {
      expect(executeBinary(primitive_less_than, 3, 5)).to.equal(1);
      expect(executeBinary(primitive_less_than, 5, 3)).to.equal(0);
    });
  });

  describe('Logic (Unary)', () => {
    it('logic.not', () => {
      expect(executeUnary(primitive_not, 0)).to.equal(1);
      expect(executeUnary(primitive_not, 1)).to.equal(0);
      expect(executeUnary(primitive_not, 100)).to.equal(0);
    });
  });
});
