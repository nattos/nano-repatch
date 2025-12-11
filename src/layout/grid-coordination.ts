import {
    GRID_UNIT,
    GRID_GAP,
    NODE_WIDTH_NORMAL,
    NODE_WIDTH_COMPRESSED,
    NODE_WIDTH_MINIMAL,
    NODE_PADDING_X,
    NODE_PADDING_Y,
    HEADER_HEIGHT,
    ROW_HEIGHT,
    PIP_OFFSET_X,
    PORT_LABEL_PADDING,
    NODE_BORDER_WIDTH
} from '../constants';
import { defaultNodeRepository } from '../structor/repository';
import { GridNode } from '../builder/state';

export interface LayoutNode {
    id: string;
    typeId: string;
    x: number; // Grid X
    y: number; // Grid Y
    width: number;  // Pixel width (derived from state)
    height: number; // Pixel height (derived from state/inputs)
}

export interface LayoutWire {
    id: string;
    fromNodeId: string;
    fromPort: string;
    toNodeId: string;
    toPort: string;
    points: { x: number, y: number }[]; // Calculated pixel points
}

export class GridCoordinationSystem {
    private nodes = new Map<string, LayoutNode>();
    private wires = new Map<string, LayoutWire>();

    // Metrics Cache
    private colWidths = new Map<number, number>();
    private rowHeights = new Map<number, number>();
    private colOffsets = new Map<number, number>();
    private rowOffsets = new Map<number, number>();

    // Wire Groups for Channel Assignment
    // Key: "channel_type:index" -> count
    private horizontalChannels = new Map<number, number>();
    private verticalChannels = new Map<number, number>();

    // Dirty Flags
    private metricsDirty = false;
    private wiresDirty = new Set<string>();

    constructor() {}

    public updateNode(node: GridNode, inferredPorts?: { inputs?: string[], outputs?: string[] }) {
        let width = NODE_WIDTH_NORMAL;
        if (node.config.viewState === 'compressed') width = NODE_WIDTH_COMPRESSED;
        if (node.config.viewState === 'minimal') width = NODE_WIDTH_MINIMAL;
        // Pinned columns
        if (node.x === 0 || node.x === 20 || (node.x as any) === 'output') width = 120; // Approx for IO

        // Calculate Height
        const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);

        let numInputs = nodeType?.inputs?.length || 0;
        let numOutputs = nodeType?.outputs?.length || 0;

        // Merge inferred if available
        if (inferredPorts) {
             // This logic mimics GraphNode render somewhat.
             // Ideally we just take the max count.
             if (inferredPorts.inputs) numInputs = Math.max(numInputs, inferredPorts.inputs.length);
             if (inferredPorts.outputs) numOutputs = Math.max(numOutputs, inferredPorts.outputs.length);
        }

        const maxPorts = Math.max(numInputs, numOutputs);
        // Header (~24) + Padding (5 top + 5 bottom internal? + NODE_PADDING_Y?)
        // Let's approximate: Header is HEADER_HEIGHT. Ports start after.
        // Padding from GraphNode styles is 5px top (on main content).
        // Let's assume height is driven by content:
        // Height = HEADER_HEIGHT + (maxPorts * ROW_HEIGHT) + 24 (padding/fudge);
        // Better to be slightly larger than smaller for grid reservations.
        const height = HEADER_HEIGHT + (maxPorts * ROW_HEIGHT) + 24;

        this.nodes.set(node.id, {
            id: node.id,
            typeId: node.config.typeId,
            x: (node.x as any) === 'output' ? 20 : Number(node.x),
            y: node.y,
            width,
            height
        });

        this.metricsDirty = true;

        // Mark connected wires dirty
        for (const wire of this.wires.values()) {
            if (wire.fromNodeId === node.id || wire.toNodeId === node.id) {
                this.wiresDirty.add(wire.id);
            }
        }
    }

    public updateWire(id: string, def: { fromNodeId: string, fromPort: string, toNodeId: string, toPort: string }) {
        this.wires.set(id, {
            id,
            ...def,
            points: []
        });
        this.wiresDirty.add(id);
    }

    public removeNode(id: string) {
        this.nodes.delete(id);
        this.metricsDirty = true;
        // Trigger wire updates?
        // Orphaned wires will just be un-routable.
    }

    public removeWire(id: string) {
        this.wires.delete(id);
        this.wiresDirty.delete(id);
    }

    private recalculateMetrics() {
        if (!this.metricsDirty) return;

        this.colWidths.clear();
        this.rowHeights.clear();

        for (const node of this.nodes.values()) {
            const currentW = this.colWidths.get(node.x) || 0;
            if (node.width > currentW) this.colWidths.set(node.x, node.width);

            const currentH = this.rowHeights.get(node.y) || 0;
            if (node.height > currentH) this.rowHeights.set(node.y, node.height);
        }

        const sortedCols = Array.from(this.colWidths.keys()).sort((a,b) => a-b);
        const maxCol = sortedCols.length > 0 ? sortedCols[sortedCols.length - 1] : 0;
        const maxRow = Math.max(...this.rowHeights.keys(), 0);

        // Force Col 0 (Input) to be at least 120px (matching CSS minmax(120px, auto))
        const col0W = this.colWidths.get(0) || 0;
        this.colWidths.set(0, Math.max(col0W, 120));

        // Note: GraphGrid CSS defines repeat(12). If maxCol > 12, we rely on implicit grid.
        // Implicit grid might not match 'gap' perfectly if not defined?
        // Actually, CSS gap property applies to implicit tracks too.

        this.colOffsets.clear();
        let currentX = 0;
        for (let i = 0; i <= maxCol; i++) {
            this.colOffsets.set(i, currentX);
            const w = this.colWidths.get(i) || 0;
            const gap = w > 0 ? GRID_GAP : 0; // Collapsed if empty
            if (w > 0 || i === 0 || i === maxCol) currentX += w + gap; // Ensure space for pinned cols
            else currentX += 0; // Collapse empty internal cols?
        }

        this.rowOffsets.clear();
        let currentY = GRID_GAP; // Initial Top Gap (match CSS [gap-top])
        for (let i = 0; i <= maxRow; i++) {
            this.rowOffsets.set(i, currentY);
            const h = this.rowHeights.get(i) || 0;
            const gap = h > 0 ? GRID_GAP : 0;
            if (h > 0) currentY += h + gap;
        }

        this.metricsDirty = false;
        // Re-route ALL wires when metrics change as geometry shifted
        for (const id of this.wires.keys()) this.wiresDirty.add(id);

        // Clear channel usage
        this.horizontalChannels.clear();
        this.verticalChannels.clear();
    }

    public cycle() {
        this.recalculateMetrics();

        if (this.wiresDirty.size === 0) return;

        // Separate wires into dirty set
        const toRoute = Array.from(this.wiresDirty);
        // Sort by id for stable processing order
        toRoute.sort();

        for (const wireId of toRoute) {
            this.routeWire(wireId);
        }
        this.wiresDirty.clear();
    }

    private getPortY(node: LayoutNode, portName: string, isInput: boolean): number {
        // Find index of port.
        // This is expensive to do repeatedly. But we need accuracy.
        const nodeType = defaultNodeRepository.getNodeType(node.typeId);
        const ports = isInput ? nodeType?.inputs : nodeType?.outputs;

        let index = 0;
        if (ports) {
            const idx = ports.findIndex(p => p.name === portName);
            if (idx >= 0) index = idx;
        }

        // Handle "value" or default ports if not found?
        // Or if dynamic port (e.g. index based)
        // Assume if name is a number, it's that index?
        if (!ports || ports.findIndex(p => p.name === portName) === -1) {
            const parsed = parseInt(portName);
            if (!isNaN(parsed)) index = parsed;
        }

        // Header + (Index * RowHeight) + HalfRow
        // GraphNode renders ports starting at HEADER_HEIGHT
        return HEADER_HEIGHT + (index * ROW_HEIGHT) + (ROW_HEIGHT / 2);
    }

    private routeWire(wireId: string) {
        const wire = this.wires.get(wireId);
        if (!wire) return;

        const srcNode = this.nodes.get(wire.fromNodeId);
        const dstNode = this.nodes.get(wire.toNodeId);
        if (!srcNode || !dstNode) {
            wire.points = [];
            return;
        }

        const srcNodeX = this.colOffsets.get(srcNode.x) || 0;
        const srcNodeY = this.rowOffsets.get(srcNode.y) || 0;
        const dstNodeX = this.colOffsets.get(dstNode.x) || 0;
        const dstNodeY = this.rowOffsets.get(dstNode.y) || 0;

        const p1 = {
            x: srcNodeX + srcNode.width + PIP_OFFSET_X,
            y: srcNodeY + this.getPortY(srcNode, wire.fromPort, false)
        };

        const p2 = {
            // Note: Inputs are on the left, but pip is usually offset negative?
            // GRAPH-PORT styles say: input left: ${PIP_OFFSET_X} (which is -9)
            // So pixel x = 0 + (-9) = -9 relative to node.
            x: dstNodeX + PIP_OFFSET_X,
            y: dstNodeY + this.getPortY(dstNode, wire.toPort, true)
        };


        // Channel Routing Logic
        // Determine vertical channel to use.
        // Midpoint channel?
        // 1. Exit Source Horizontal
        // 2. Vertical Segment in channel between Src and Dst columns?
        // Src Col Index vs Dst Col Index.
        // Ideally we pick the largest gap?
        // For standard L-shape:
        // If Dst > Src (Forward):
        //   Channel is somewhere between.
        //   Let's pick the midpoint in pixel space for now, or the gap after Src Col?

        // Simple heuristic: Midpoint X
        let midX = (p1.x + p2.x) / 2;

        // Enhance with Lanes later.
        // For now, strict Orthogonal.

        wire.points = [
            p1,
            { x: midX, y: p1.y },
            { x: midX, y: p2.y },
            p2
        ];
    }

    public getWireLayouts() {
        const result: Record<string, { path: {x:number, y:number}[] }> = {};
        for (const [id, wire] of this.wires) {
            result[id] = { path: wire.points };
        }
        return result;
    }
}
