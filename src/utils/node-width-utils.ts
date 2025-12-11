import { PortHint } from '../structor/repository';

export type NodeVisualState = 'minimal' | 'compressed' | 'normal';

// Helper to determine if input editor (slider/field) should show
export function shouldShowInputEditor(input: PortHint, isConnected: boolean): boolean {
  if (input.alwaysShowInputEditor) return true;
  if (isConnected) return false;
  if (input.suppressInputEditor) return false;
  // Default: Show editor if not connected
  return true;
}

// Helper to calculate port Y position
export function checkCompiledPortY(
    nodeId: string,
    portName: string,
    isInput: boolean,
    localState: any, // localController.observableState
    defaultRepository: any // defaultNodeRepository
): number | null {
    // Dynamic Port Logic needs compiled config
    // This part is coupled to repository/controller, so maybe keep it closer to usage
    // or just pass the arrays of ports.
    // Let's pass the PortHint[] directly to a calculator instead.
    return null;
}

export function calculatePortY(index: number): number {
    // Header: 24
    // Padding Y: 2 (from GraphNode CSS .inputs top:2px)
    // Row Height: 24
    // Pip Offset Y (from row top): 12
    // Y = 24 + 2 + (index * 24) + 12 = 38 + (index * 24)
    return 24 + 2 + (index * 24) + 12;
}

// Helper to determine visual state
export function getNodeVisualState(
  inputs: PortHint[],
  outputs: PortHint[],
  connectedPortNames: Set<string>,
  hasCustomBody: boolean
): NodeVisualState {
  let hasVisibleSliders = false;

  for (const input of inputs) {
    const isConnected = connectedPortNames.has(input.name);
    if (shouldShowInputEditor(input, isConnected)) {
      hasVisibleSliders = true;
      break;
    }
  }

  if (!hasVisibleSliders && !hasCustomBody) {
    if (inputs.length <= 1 && outputs.length <= 1) {
      return 'minimal';
    } else {
      return 'compressed';
    }
  }

  return 'normal';
}

// Helper to calculate Grid Span
export function getGridSpan(state: NodeVisualState): number {
  switch (state) {
    case 'minimal': return 1;
    case 'compressed': return 3;
    case 'normal': return 5;
    default: return 5;
  }
}

// Helper to calculate Node Height (shared between GraphGrid and WireRenderer)
export function calculateNodeHeight(
    node: any, // GridNode (avoid circular dep if possible, or use any)
    nodeType: any, // NodeType
    connectedPorts: Set<string>, // Set of connected port names
    inferredInputs?: any[], // StructorType[]
    inferredOutputs?: any[] // StructorType[]
): number {
    if (!node) return 80;

    let inputs = nodeType?.inputs || [];
    let outputs = nodeType?.outputs || [];

    if (inferredInputs) inputs = inferredInputs;
    if (inferredOutputs) outputs = inferredOutputs;



    let totalInputHeight = 0;
    inputs.forEach((input: any) => {
        const isConnected = connectedPorts.has(input.name);
        let h = 24;

        const showEditor = (input.alwaysShowInputEditor || (!isConnected && !input.suppressInputEditor));
        if (showEditor) {
             if (nodeType?.getInputEditorHeight) {
                 h = nodeType.getInputEditorHeight(node, input.name);
             } else if (node.config.typeId === 'debug.scope' && input.name === 'value') {
                 h = 96; // HACK: Hardcoded for scope
             }
        }
        totalInputHeight += h;
    });

    const totalOutputHeight = outputs.length * 24;
    const portsHeight = Math.max(totalInputHeight, totalOutputHeight, 24);

    const bodyHeight = nodeType?.getBodyHeight?.(node) || 0;
    let estimatedBodyHeight = bodyHeight;
    // Heuristic for custom UI
    if (estimatedBodyHeight === 0 && (nodeType?.renderBody || nodeType?.ui?.body)) {
        estimatedBodyHeight = 96;
    }

    // Check minimal logic
    let hasVisibleSliders = false;
    for (const input of inputs) {
        const isConnected = connectedPorts.has(input.name);
        if (input.alwaysShowInputEditor || (!isConnected && !input.suppressInputEditor)) {
            hasVisibleSliders = true;
            break;
        }
    }
    const hasCustomBody = !!(estimatedBodyHeight > 0);

    if (!hasVisibleSliders && !hasCustomBody) {
         if (inputs.length <= 1 && outputs.length <= 1) return 80;
    }

    return 24 + portsHeight + 8 + estimatedBodyHeight;
}
