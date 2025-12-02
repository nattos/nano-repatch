import { describe, it, expect } from 'vitest';
import { PortHint } from '../structor/repository';

// Mock the logic from GraphNode
function resolveValue(node: any, input: PortHint) {
  let configValue = node.config.values && node.config.values[input.name];

  // Fallback: Check top-level config
  if (configValue === undefined && (node.config as any)[input.name] !== undefined) {
    configValue = (node.config as any)[input.name];
  }

  const currentValue = configValue !== undefined
    ? configValue
    : (input.defaultValue !== undefined ? input.defaultValue : ((input.type as any).defaultValue !== undefined ? (input.type as any).defaultValue : ''));

  return currentValue;
}

describe('Slider Value Resolution Logic', () => {
  it('should resolve value from config.values', () => {
    const node = {
      config: {
        values: {
          min: 0.2,
          max: 0.8
        }
      }
    };
    const inputMin = { name: 'min', type: { defaultValue: 0 } } as PortHint;
    const inputMax = { name: 'max', type: { defaultValue: 1 } } as PortHint;

    expect(resolveValue(node, inputMin)).toBe(0.2);
    expect(resolveValue(node, inputMax)).toBe(0.8);
  });

  it('should resolve value from top-level config (fallback)', () => {
    const node = {
      config: {
        values: {},
        min: 0.3,
        max: 0.7
      }
    };
    const inputMin = { name: 'min', type: { defaultValue: 0 } } as PortHint;
    const inputMax = { name: 'max', type: { defaultValue: 1 } } as PortHint;

    expect(resolveValue(node, inputMin)).toBe(0.3);
    expect(resolveValue(node, inputMax)).toBe(0.7);
  });

  it('should use defaultValue if config is missing', () => {
    const node = {
      config: {
        values: {}
      }
    };
    const inputMin = { name: 'min', defaultValue: 0.1 } as PortHint;
    const inputMax = { name: 'max', type: { defaultValue: 0.9 } } as PortHint;

    expect(resolveValue(node, inputMin)).toBe(0.1);
    expect(resolveValue(node, inputMax)).toBe(0.9);
  });

  it('should handle mixed sources', () => {
    const node = {
      config: {
        values: {
          min: 0.2
        },
        max: 0.8 // Top-level
      }
    };
    const inputMin = { name: 'min', type: { defaultValue: 0 } } as PortHint;
    const inputMax = { name: 'max', type: { defaultValue: 1 } } as PortHint;

    expect(resolveValue(node, inputMin)).toBe(0.2);
    expect(resolveValue(node, inputMax)).toBe(0.8);
  });

  it('should handle multiple inputs correctly', () => {
    const node = {
      config: {
        values: {
          a: 1,
          b: 2,
          c: 3
        }
      }
    };
    const inputs = [
      { name: 'a', type: { defaultValue: 0 } },
      { name: 'b', type: { defaultValue: 0 } },
      { name: 'c', type: { defaultValue: 0 } }
    ] as PortHint[];

    const results = inputs.map(i => resolveValue(node, i));
    expect(results).toEqual([1, 2, 3]);
  });
});
