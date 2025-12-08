import { expect } from '@open-wc/testing';
import { broadcast, BroadcastResult } from './broadcast';
import { StructorRecord } from './structor';

describe('Broadcast System', () => {
  it('should handle scalar inputs', () => {
    const inputs: StructorRecord = {
      fields: { a: 1, b: 2 },
      
    };
    const config = {
      outputs: {
        a: { fromFields: ['a'], combine: 'first' },
        b: { fromFields: ['b'], combine: 'first' }
      },
      reshape: 'vector'
    };

    const result = broadcast(config, inputs);
    expect(result).to.be.instanceOf(BroadcastResult);

    const output = result.apply((args: any) => {
      return args.a + args.b;
    });

    expect(output).to.equal(3);
  });

  it('should handle vector inputs', () => {
    const inputs: StructorRecord = {
      fields: { a: [1, 2, 3], b: 10 }
    };
    const config = {
      outputs: {
        a: { fromFields: ['a'], combine: 'first' },
        b: { fromFields: ['b'], combine: 'first' }
      },
      reshape: 'vector'
    };

    const result = broadcast(config, inputs);
    const output = result.apply((args: any) => {
      return args.a + args.b;
    });

    expect(output).to.deep.equal([11, 12, 13]);
  });

  it('should zip vectors of same length', () => {
    const inputs: StructorRecord = {
      fields: { a: [1, 2, 3], b: [10, 20, 30] },
      
    };
    const config = {
      outputs: {
        a: { fromFields: ['a'], combine: 'first' },
        b: { fromFields: ['b'], combine: 'first' }
      },
      reshape: 'vector'
    };

    const result = broadcast(config, inputs);
    const output = result.apply((args: any) => {
      return args.a + args.b;
    });

    expect(output).to.deep.equal([11, 22, 33]);
  });

  it('should repeat scalars to match vector length', () => {
    const inputs: StructorRecord = {
      fields: { a: [1, 2, 3], b: 10, c: 100 },
      
    };
    const config = {
      outputs: {
        a: { fromFields: ['a'], combine: 'first' },
        b: { fromFields: ['b'], combine: 'first' },
        c: { fromFields: ['c'], combine: 'first' }
      },
      reshape: 'vector'
    };

    const result = broadcast(config, inputs);
    const output = result.apply((args: any) => {
      return args.a + args.b + args.c;
    });

    expect(output).to.deep.equal([111, 112, 113]);
  });

  it('should handle mismatched vector lengths (round-robin cycle)', () => {
    const inputs: StructorRecord = {
      fields: { a: [1, 2], b: [10, 20, 30] },
      
    };
    const config = {
      outputs: {
        a: { fromFields: ['a'], combine: 'first' },
        b: { fromFields: ['b'], combine: 'first' }
      },
      reshape: 'vector'
    };

    const result = broadcast(config, inputs);
    const output = result.apply((args: any) => {
      return args.a + args.b;
    });

    // Expect round-robin cycling:
    // i=0: 1 + 10 = 11
    // i=1: 2 + 20 = 22
    // i=2: 1 + 30 = 31 (a cycles back to 1)
    expect(output).to.deep.equal([11, 22, 31]);
  });

  it('should support named fields in apply lambda', () => {
    const inputs: StructorRecord = {
      fields: { val: 10, min: 0, max: 100 },
      
    };
    // Config that maps inputs to specific names for the lambda
    const config = {
      outputs: {
        value: { fromFields: ['val'], combine: { reduce: 'first' } },
        minimum: { fromFields: ['min'], combine: { reduce: 'first' } },
        maximum: { fromFields: ['max'], combine: { reduce: 'first' } }
      },
      reshape: 'vector'
    };

    const result = broadcast(config, inputs);
    const output = result.apply((args: any) => {
      return Math.max(args.minimum, Math.min(args.maximum, args.value));
    });

    expect(output).to.equal(10);
  });
});
