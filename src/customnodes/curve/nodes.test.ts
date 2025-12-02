import { curve_ease } from './nodes';
import { createNodeHarness } from '../../structor/test-utils';
import { GraphWidgetConfig } from './types';

describe('curve.ease', () => {
    const harness = createNodeHarness<{ value: number, easing: GraphWidgetConfig }, { result: number }>(curve_ease);

    const defaultConfig: GraphWidgetConfig = {
        domain: [0, 1],
        range: [0, 1],
        segments: [{
            id: 's1',
            weight: 1,
            curve: { type: 'exponential', value: 0 } // Linear
        }]
    };

    const execute = (value: number, config: GraphWidgetConfig = defaultConfig) => {
        // We pass 'easing' as an input because in our new definition, easing IS an input.
        // The harness handles the default value if we don't pass it, but here we want to control it.
        const result = harness.execute({ value, easing: config });
        return result.result;
    };

    it('should handle linear curve', () => {
        expect(execute(0)).toBeCloseTo(0);
        expect(execute(0.5)).toBeCloseTo(0.5);
        expect(execute(1)).toBeCloseTo(1);
    });

    it('should handle exponential curve', () => {
        const config: GraphWidgetConfig = {
            ...defaultConfig,
            segments: [{
                id: 's1',
                weight: 1,
                curve: { type: 'exponential', value: 1 } // Up Arc (exponent 0.1)
            }]
        };
        // t=0.5, exp=0.1 -> 0.5^0.1 ≈ 0.933
        expect(execute(0.5, config)).toBeCloseTo(Math.pow(0.5, 0.1));
    });

    it('should handle step curve', () => {
        const config: GraphWidgetConfig = {
            ...defaultConfig,
            segments: [{
                id: 's1',
                weight: 1,
                curve: { type: 'step', value: 2 } // 2 steps
            }]
        };
        // 0-0.5 -> 0
        // 0.5-1 -> 1
        expect(execute(0.25, config)).toBeCloseTo(0);
        expect(execute(0.75, config)).toBeCloseTo(1);
    });

    it('should handle multi-segment', () => {
        const config: GraphWidgetConfig = {
            ...defaultConfig,
            segments: [
                { id: 's1', weight: 1, curve: { type: 'linear' } },
                { id: 's2', weight: 1, curve: { type: 'linear' } }
            ]
        };
        // Total weight 2.
        // s1: 0-0.5 input t.
        // s2: 0.5-1 input t.

        // t=0.25 (middle of s1). s1 local t = 0.5. s1 linear -> 0.5.
        expect(execute(0.25, config)).toBeCloseTo(0.5);
    });

    it('should apply default value when input is missing', () => {
        // Test the default value logic (0)
        // We don't pass value, so it should default to 0.
        const result = harness.execute({ easing: defaultConfig });
        expect(result.result).toBeCloseTo(0);
    });
});
