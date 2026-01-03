import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalController } from './local-state';
import { defaultNodeRepository } from '../structor/repository';
import { GraphState } from './state';

// Mock Worker
class MockWorker {
  onmessage: ((event: any) => void) | null = null;
  postMessage(data: any) { }
  terminate() { }
}

const originalWorker = global.Worker;

describe('LocalController Viewport Logic', () => {
  let controller: LocalController;

  beforeEach(() => {
    global.Worker = MockWorker as any;
    const mockAppController = {} as any;
    controller = new LocalController(mockAppController);
  });

  afterEach(() => {
    global.Worker = originalWorker;
  });

  it('should return default coordinates if viewport is not set (0,0)', () => {
    // Initial state is 0,0,0,0
    controller.setViewport(0, 0, 0, 0);
    const coords = controller.getViewportCenterGridCoordinates();
    // Default fallback in implementation was 5,5 if (!viewport), but viewport IS initialized to 0,0,0,0.
    // However, 0 width/height means center is 0,0.
    // Offsets are empty.
    // Loop over empty offsets -> gridY = 0.
    // Returns { x: 5, y: 0 } based on implementation logic.
    expect(coords.x).toBe(5);
    expect(coords.y).toBe(5);
  });

  it('should calculate correct grid Y based on row offsets', () => {
    // 1. Setup Mock GridMetrics
    // Row 0: Starts at 16, Height 80. Top of Row 1 = 16 + 80 + 16 = 112.
    // Row 1: Starts at 112, Height 80. Top of Row 2 = 112 + 80 + 16 = 208.
    // Row 2: Starts at 208.

    // We need to inject these into observableState explicitly since we skip updateGridMetrics logic
    controller.observableState.gridMetrics.rowOffsets.set(0, 16);
    controller.observableState.gridMetrics.rowOffsets.set(1, 112);
    controller.observableState.gridMetrics.rowOffsets.set(2, 208);

    // 2. Set Viewport centered on Row 1
    // Row 1 is y=112 to y=192. Center approx 152.
    // Let's set viewport such that center Y = 152.
    // e.g. y=100, h=104 -> limit 100 + 52 = 152.

    controller.setViewport(0, 100, 800, 104);

    const coords = controller.getViewportCenterGridCoordinates();
    expect(coords.y).toBe(1);
    expect(coords.x).toBe(5); // Default X
  });

  it('should handle scrolling down to further rows', () => {
    controller.observableState.gridMetrics.rowOffsets.set(0, 16);
    controller.observableState.gridMetrics.rowOffsets.set(1, 112);
    controller.observableState.gridMetrics.rowOffsets.set(10, 1000);
    // Gaps/Empty rows might be implicit in iterating usage, but here we sparsely populate.
    // The implementation iterates `rowOffsets` map values.
    // Map iteration order is insertion order!
    // `updateGridMetrics` inserts in order 0..maxRow.
    // So we should insert properly.

    controller.observableState.gridMetrics.rowOffsets.clear();
    controller.observableState.gridMetrics.rowOffsets.set(0, 16);
    controller.observableState.gridMetrics.rowOffsets.set(1, 112);
    controller.observableState.gridMetrics.rowOffsets.set(2, 208);

    // Set viewport to center on approx 250 (Row 2 starts 208)
    controller.setViewport(0, 200, 1000, 100); // Center Y = 250

    const coords = controller.getViewportCenterGridCoordinates();
    expect(coords.y).toBe(2);
  });

  it('should extrapolate grid Y when viewport is below all existing content (empty space)', () => {
    // 1. Populate metrics for just a few rows
    controller.observableState.gridMetrics.rowOffsets.set(0, 16);
    // Row 0 Height 80. Next start 112.
    // Last known row is 0.

    // 2. Scroll WAY down. e.g. Y=1000.
    // Should be around row 10 or so.
    controller.setViewport(0, 1000, 1000, 100); // Center Y = 1050

    const coords = controller.getViewportCenterGridCoordinates();
    // Implementation currently clamps to last known row (0).
    // EXPECTATION: It should be > 0.
    expect(coords.y).toBeGreaterThan(0);
    // Approx: (1050 - 112) / 96 = ~9.7 -> Row 9+1 = 10?
    // Let's just assert > 0 for now to prove the bug.
    expect(coords.y).toBeGreaterThan(5);
  });
});
