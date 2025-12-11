import { computeWireLayout, WireDef } from '../layout/wire-layout';
import { registerPrimitives } from '../structor/primitives';

// Mock lit/decorators just in case WireLayout uses them (it shouldn't)
jest.mock('lit', () => ({}));
jest.mock('lit/decorators.js', () => ({ customElement: () => (cls: any) => cls }));

// No Settings Mocks needed.

describe('Jog Reproduction', () => {
    beforeAll(() => {
        // registerPrimitives();
    });

    test('WireLayout Obstacle Handling', () => {
        // 1. Setup Scenario manually
        // Wire: Hub -> Clamp
        // Hub (0,0). Clamp (2,0).
        // Offsets verified as 2 and 2 by manual calculation.

        const wireDef: WireDef = {
            id: 'c1',
            start: { x: 0, y: 0 },
            end: { x: 2, y: 0 },
            fromPort: 'value',
            toPort: 'min',
            startOffset: 2,
            endOffset: 2
        };

        // Obstacles
        // Hub at 0,0 Height 2. Blocks X=0 lanes 0,1.
        // Clamp at 2,0 Height 4. Blocks X=2 lanes 0,1,2,3.
        const obstacles = [
            { x: 0, y: 0, height: 2 },  // Hub (Start Node)
            { x: 2, y: 0, height: 4 }   // Clamp (End Node)
        ];

        console.log('Running Layout with Obstacles:', JSON.stringify(obstacles));
        console.log('WireDef inputs:', JSON.stringify(wireDef));

        const result = computeWireLayout([wireDef], obstacles);

        const segments = result.segments; // array
        console.log('Segments:', JSON.stringify(segments));

        // Assertions
        // Expect NO vertical segments
        const verticals = segments.filter((s: any) => s.type === 'v');
        if (verticals.length > 0) {
            console.error('FAILED: FOUND VERTICAL SEGMENTS (Jogs)!', verticals);
            // FAIL result explicitly?
            expect(verticals.length).toBe(0);
        } else {
            console.log('SUCCESS: Straight line.');
        }
    });
});
