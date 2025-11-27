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
