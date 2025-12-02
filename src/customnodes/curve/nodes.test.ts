import { curve_ease } from './nodes';
import { ExecutionContext } from '../../structor/structor';

describe('curve.ease', () => {
    const mockContext: ExecutionContext = {
        broadcast: (config, inputs) => {
            // Simple mock: just return a functor that calls the callback with the inputs
            // This assumes no broadcasting is actually needed for single values
            return {
                apply: (callback: any) => callback(inputs)
            };
        }
    } as any;

    const execute = (value: number, config: any) => {
        const output = curve_ease.execute({ value }, { easing: config }, mockContext);
        // console.log('Full Output:', JSON.stringify(output, null, 2));
        if (!output || !output.fields) {
             console.error('Output or fields is undefined:', output);
             return undefined;
        }
        return output.fields.result as number;
    };

    const defaultConfig = {
        domain: [0, 1],
        range: [0, 1],
        segments: [{
            id: 's1',
            weight: 1,
            curve: { type: 'exponential', value: 0 } // Linear
        }]
    };

    it('should handle linear curve', () => {
        expect(execute(0, defaultConfig)).toBeCloseTo(0);
        expect(execute(0.5, defaultConfig)).toBeCloseTo(0.5);
        expect(execute(1, defaultConfig)).toBeCloseTo(1);
    });

    it('should handle exponential curve', () => {
        const config = {
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
        const config = {
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
        const config = {
            ...defaultConfig,
            segments: [
                { id: 's1', weight: 1, curve: { type: 'linear' } }, // 0-0.5 -> 0-1 (mapped to 0-0.5 in total?) No, mapped to output range
                { id: 's2', weight: 1, curve: { type: 'linear' } }
            ]
        };
        // Total weight 2.
        // s1: 0-0.5 input t.
        // s2: 0.5-1 input t.

        // t=0.25 (middle of s1). s1 local t = 0.5. s1 linear -> 0.5.
        // Output range 0-1.
        // Wait, the node maps the *result* of the curve (normY) to the output range.
        // So s1 output 0.5 -> 0.5?
        // Yes, the logic is: evaluate curve -> normY (0-1) -> map to range.

        expect(execute(0.25, config)).toBeCloseTo(0.5);
    });
});
