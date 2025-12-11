
import { computeWireLayout, WireDef, SegmentType } from './wire-layout';

describe('WireLayout Isolation', () => {
    test('Identifies End Segment Correctly for Downward Path', () => {
        // Mock Wire: Start (0,0) -> End (0,3).
        // Vertical Step Down.
        // Start Node (x=0,y=0). Logic X=1. Logic Y=0.
        // End Node (x=0,y=3). Logic X=1. Logic Y=12. (Scaled by 4).

        // Wait, scale is handled inside?
        // No, computeWireLayout assumes wire.start/end are Node Coordinates.
        // And it calls toLogical.

        const wire: WireDef = {
            id: 'test-wire',
            start: { x: 0, y: 0 },
            end: { x: 0, y: 3 }, // 3 units down
            fromPort: 'out',
            toPort: 'in',
            startOffset: 0,
            endOffset: 0 // Target same row for simplicity
        };

        // Run Layout
        const result = computeWireLayout([wire]);
        const wireSegs = result.segments.filter(s => s.wireId === 'test-wire');

        // Analyze Segments
        console.log('Segments:', wireSegs.map(s => `${s.x},${s.y} [${s.type}]`).join(' -> '));

        // Get actual path segments (excluding Stub Start/End)
        const pathSegs = wireSegs.filter(s => s.type !== 'start' && s.type !== 'end');

        // Must assume path exists
        expect(pathSegs.length).toBeGreaterThan(0);

        const lastNonVertical = pathSegs.find(s => s.type !== SegmentType.Vertical && s.type !== SegmentType.Horizontal); // Look for the corner
        // Actually, just check that NO vertical exists at the very end row if it's connected to a corner?
        // Let's just check that we have a Corner at the target Y.
        // Target Y = 96 (3 * 32).
        const endCorner = pathSegs.find(s => s.y === 96 && (s.type === SegmentType.CornerBR || s.type === SegmentType.CornerTR || s.type === SegmentType.CornerBL || s.type === SegmentType.CornerTL));

        expect(endCorner).toBeDefined();
        // And ensure no Vertical at Y=96
        const endVertical = pathSegs.find(s => s.y === 96 && s.type === SegmentType.Vertical);
        expect(endVertical).toBeUndefined();
    });

    test('Reproduces Vertical Segment Bug with Offset', () => {
        // Simulation of User Scenario:
        // Huge Vertical Drop.
        // End Offset 1.

        const wire: WireDef = {
            id: 'bug-wire',
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
            fromPort: 'out',
            toPort: 'in',
            startOffset: 0,
            endOffset: 1 // 1 Row down
        };

        const result = computeWireLayout([wire]);
        const wireSegs = result.segments.filter(s => s.wireId === 'bug-wire' && s.type !== 'start' && s.type !== 'end');

        console.log('Bug Wire Path:', wireSegs.map(s => `${s.x},${s.y} [${s.type}]`).join(' -> '));

        // Check for Vertical segments at the destination Y or adjacent Node Row Y.
        // In this case (Bug Wire), End is at 0,33 (Logic).
        // The path goes down to Y=33. (Slot 1 Node).
        // We expect a Corner at Y=33.
        // We expect NO Vertical at Y=33 (Slot 1 Vertical).
        // (Assuming Coalescing worked).

        // Check Y=33
        const verticalAt33 = wireSegs.find(s => s.y === 33 && s.type === SegmentType.Vertical);
        if (verticalAt33) {
             throw new Error(`Found Vertical Segment at End (Y=33): ${verticalAt33.x},${verticalAt33.y}`);
        }

        const cornerAt33 = wireSegs.find(s => s.y === 33 && (s.type === SegmentType.CornerBL || s.type === SegmentType.CornerBR || s.type === SegmentType.CornerTL || s.type === SegmentType.CornerTR));
        if (!cornerAt33) {
             console.warn('Warning: No Corner found at Y=33, check logic.');
        }
    });

    test('Coalescing Logic: Preserves Gap Segment, Removes Node Overlap', () => {
        // Manually construct segments to test coalescing logic strictly.
        // We can't easily mock inner helper, but we can infer behavior from result.
        // Let's rely on a specific layout scenario.

        // Scenario: Short hop.
        // Start (0,0) -> End (0,1).
        // Y=0 to Y=4 (1 Step down).
        // Path logical Y: 0, 1, 2, 3, 4.
        // y=0: Node Top.
        // y=1,2: Node.
        // y=3: Gap.
        // y=4: Next Node Top.

        // If we have V at 3 (Gap) and Corner at 4 (Node).
        // They are in different buckets (Slot 0 vs Slot 1) in current logic?
        // Slot 0: y=0,1,2,3.
        // Slot 1: y=4,5,6,7.
        // So V(3) is in Slot 0. Corner(4) is in Slot 1.
        // Coalescing won't touch V(3). Correct.

        // Scenario: Overlap in Node Row.
        // V at 4 (Node), Corner at 4 (Node).
        // Duplicate point? Dedup handles it.
        // V at 4, Corner at 5?
        // y=4,5 are in Slot 1. Same bucket.
        // V(4) should be removed if Corner(5) exists?
        // Yes, because Corner(5) (mid-node) will draw up to top?
        // If Corner is BR (Down->Left), it draws Top-half.
        // If at y=5 (offset 40px?), it draws 0-40px.
        // V(4) (offset 12px?) draws 0-100% of cell?
        // Actually V(4) draws Full Cell.
        // If Corner(5) is in same cell, it draws Partial.
        // We want Corner. We assume Corner correctly covers relevant vertical space.

        const wire: WireDef = {
            id: 'coalesce-test',
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 }, // 1 Row down
            fromPort: 'out', // Right
            toPort: 'in', // Left
            startOffset: 0,
            endOffset: 1 // Target Row 1 inside Node 1?
            // Node 1 starts at logical Y=4.
            // endOffset=1 -> Target Y=5.
        };

        // Expected Path:
        // Start (Node A, Y=0). Out Right -> Gap (X=2).
        // Logically: Gap is now at Y=31 (Scale 0..31, Gap 31).
        // Node 1 starts at Y=32.
        // Target Y=33 (Offset 1).

        // Segments:
        // ...
        // (2,31) v (Gap!)
        // (2,32) v (Node Top)
        // (2,33) Corner (Node Mid)

        const result = computeWireLayout([wire]);
        const segs = result.segments.filter(s => s.wireId === 'coalesce-test' && s.type !== 'start' && s.type !== 'end');

        // Y=32 (Vertical) should be removed if Y=33 (Corner) exists in same bucket.
        // They are both in Slot 1.

        const v32 = segs.find(s => s.y === 32 && s.type === SegmentType.Vertical);
        const c33 = segs.find(s => s.y === 33); // Should be corner

        if (!c33) throw new Error('Expected Corner at Y=33');
        if (v32) throw new Error('Expected V at Y=32 to be removed by Coalescing!');

        // Verify Gap at Y=31 preserved
        const v31 = segs.find(s => s.y === 31 && s.type === SegmentType.Vertical);
        if (!v31) throw new Error('Expected Gap Segment at Y=31 to be preserved!');

        console.log('Coalescing Validated: V(32) removed, V(31) kept.');
    });
});
