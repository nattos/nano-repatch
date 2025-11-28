import { GridNode } from '../builder/state';
import { NodeType } from '../structor/repository';
import { GraphState } from '../builder/state';

export function getPortPosition(
  node: GridNode,
  portName: string,
  type: 'in' | 'out',
  nodeType: NodeType | undefined,
  loadedSubgraphs: Map<string, GraphState>,
  scrollLeft: number = 0,
  clientWidth: number = 0
): { x: number, y: number } {
  if (!node) return { x: 0, y: 0 };

  let nodeX = 0;
  let nodeY = node.y * 110 + 65; // Base Y in pixels

  if (node.config.typeId === 'input') {
    nodeX = 10 + scrollLeft;
  } else if (node.config.typeId === 'output') {
    nodeX = clientWidth - 130 + scrollLeft;
  } else {
    nodeX = 120 + (node.x - 1) * 110 + 80;
  }

  // Calculate port offset within the node
  let ports: any[] = [];

  if (nodeType) {
    const dynamicInfo = nodeType.getPorts?.(node, loadedSubgraphs);
    if (dynamicInfo) {
      ports = type === 'in' ? dynamicInfo.inputs : dynamicInfo.outputs;
    } else {
      ports = type === 'in' ? (nodeType.inputs || []) : (nodeType.outputs || []);
    }
  }

  const portIndex = ports.findIndex(p => p.name === portName);
  const count = ports.length;

  // Vertical distribution: 5px padding top/bottom, 90px available height
  // Center of the slot: 5 + (index + 0.5) * (90 / count)
  const offsetY = count > 0 ? 5 + (90 / count) * (portIndex + 0.5) : 50;

  // Horizontal offset
  // Inputs: -10px (visual left edge)
  // Outputs: 110px (visual right edge)
  const offsetX = type === 'in' ? -10 : 110;

  // Convert to grid units relative to cell center (70, 60)
  // render() does: val * 110 + 70 (X) / + 60 (Y)
  // So we want: (NodePos + PortPos - Offset) / 110
  return {
    x: (nodeX + offsetX - 70) / 110,
    y: (nodeY + offsetY - 60) / 110
  };
}

// Grid Coordinate Helpers

/**
 * Converts a logical node X coordinate (0-indexed) to a CSS Grid Column index.
 *
 * Grid Structure:
 * Col 1: Input Column
 * Col 2: Gap
 * Col 3: Node 1
 * Col 4: Gap
 * Col 5: Node 2
 * ...
 * Col 2*x + 1: Node x (where x starts at 1)
 *
 * Logic:
 * Input (x=0) -> Col 1
 * Node x (x>=1) -> Gap (2) + (x-1)*2 + 1 = 2 + 2x - 2 + 1 = 2x + 1
 * Wait, let's trace:
 * Input: Col 1
 * Gap: Col 2
 * Node 1: Col 3
 * Gap: Col 4
 * Node 2: Col 5
 *
 * Formula for Node x (x>=1): 2*x + 1
 * Formula for Input (x=0): 1
 * Formula for Output: Last column? Handled separately usually.
 */
export function getNodeGridColumn(x: number): number {
  if (x === 0) return 1; // Input column
  // For output column, we might need to know the total width or handle it specially.
  // Assuming x is a valid node index >= 1
  return 2 * x + 1;
}

/**
 * Converts a logical node Y coordinate (0-indexed) to a CSS Grid Row index.
 *
 * Grid Structure:
 * Row 1: Gap (Top padding?) Or Node 0?
 * Let's assume Row 1 is Node 0 (y=0).
 * Wait, the plan said: `repeat(auto-fill, [gap] 10px [node] 100px)`
 * This implies:
 * Row 1: Gap
 * Row 2: Node 0
 * Row 3: Gap
 * Row 4: Node 1
 *
 * Formula for Node y: 2*y + 2
 */
export function getNodeGridRow(y: number): number {
  return 2 * y + 2;
}

/**
 * Converts a logical gap X coordinate to a CSS Grid Column index.
 * Gap x is the gap AFTER Node x.
 * Gap 0: After Input (Col 2)
 * Gap 1: After Node 1 (Col 4)
 * Gap x: 2*x + 2
 */
export function getGapGridColumn(x: number): number {
  return 2 * x + 2;
}

/**
 * Converts a logical gap Y coordinate to a CSS Grid Row index.
 * Gap y is the gap AFTER Node y.
 * Gap -1: Before Node 0 (Row 1)
 * Gap 0: After Node 0 (Row 3)
 * Gap y: 2*y + 3
 */
export function getGapGridRow(y: number): number {
  return 2 * y + 3;
}

/**
 * Converts a wire path point (grid units) to CSS Grid Column/Row.
 *
 * Wire Path Points:
 * x is in 0.5 increments? No, `WireLayout` uses integer grid points on a 2x grid?
 * `WireLayout` returns `path` in 1x coordinates (fractional).
 *
 * Let's look at `WireLayout`:
 * `result.wires[wire.id] = { path, ... }` where path is `x, y` (fractional).
 *
 * If x is integer: Center of a cell (Node or Gap?)
 * In `GraphConnection`, we did: `x * 110 + 10`.
 *
 * Let's align with the new grid:
 * Node 1 center: Col 3.
 * Gap 1 center: Col 4.
 *
 * If x = 1.0 -> Node 1 -> Col 3
 * If x = 1.5 -> Gap 1 -> Col 4
 * If x = 2.0 -> Node 2 -> Col 5
 *
 * Formula: 2*x + 1
 * Check:
 * x=1 -> 3 (Correct)
 * x=1.5 -> 4 (Correct)
 * x=2 -> 5 (Correct)
 *
 * So `getGridColumn(x) = 2*x + 1` works for both nodes and gaps if x is in 0.5 steps.
 */
export function getGridColumn(x: number): number {
  return Math.round(2 * x + 1);
}

export function getGridRow(y: number): number {
  // y=0 -> Node 0 -> Row 2
  // y=0.5 -> Gap 0 -> Row 3
  // y=1 -> Node 1 -> Row 4
  // Formula: 2*y + 2
  return Math.round(2 * y + 2);
}

