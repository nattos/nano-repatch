import { html, TemplateResult } from 'lit';
import { cssColorFromHash } from '../utils/layout-utils';
import { defaultNodeRepository, PortHint } from '../structor/repository';
import { calculatePortY } from '../utils/node-width-utils';
import { WireSegment } from '../layout/wire-layout';
import { Connection, GridNode } from '../builder/state';
import { Selectable, GridMetrics } from '../builder/local-state';
import { StructorType } from '../structor/structor';

export interface WireRendererContext {
    nodes: Record<string, GridNode>;
    connections: Record<string, Connection>;
    gridMetrics: GridMetrics;
    inferredNodeTypes: Map<string, { inputs: StructorType, outputs: StructorType }>;
    effectiveNodeTypes: Map<string, { inputs: PortHint[], outputs: PortHint[] }>;
    incomingConnections: Map<string, string[]>;
    selection: Set<string> | Map<string, Selectable>;
    onWireClick: (wireId: string, e: MouseEvent) => void;
    onWireDblClick: (wireId: string, e: MouseEvent) => void;
}

export class WireRenderer {
    private ctx: WireRendererContext;

    constructor(ctx: WireRendererContext) {
        this.ctx = ctx;
    }

    render(segments: WireSegment[]): TemplateResult[] {


        return segments.map(seg => {
            const LOGICAL_Y_SCALE = 32;
            const GAP_LANE_INDEX = 31;

            const logicalSlot = Math.floor(seg.y / LOGICAL_Y_SCALE);
            const rem = seg.y % LOGICAL_Y_SCALE;

            // Default to 80 to match LocalController logic for empty rows
            const h = (this.ctx.gridMetrics.rows.get(logicalSlot) !== undefined) ? this.ctx.gridMetrics.rows.get(logicalSlot)! : 80;

            // Determine Grid Absolute Y (where the wire layout thinks the wire is)
            const nodeTopAbs = this.ctx.gridMetrics.rowOffsets.get(logicalSlot) ?? (16 + (logicalSlot * 96));
            let remOffset = 8;
            if (rem < GAP_LANE_INDEX) {
                remOffset = 16 + (rem * 24);
            } else {
                // Hybrid Logic: If h=0, target Top (Boundary). Else target Center.
                // Gap Row Top = Node Top + h.
                // Center is 9px into Gap Row.
                remOffset = (h !== undefined && h > 0) ? (h + 9) : 9;
            }
            const gridAbsY = nodeTopAbs + remOffset;

            let wireColor = '#888';
            let targetAbsY: number | undefined;

            if (seg.wireId) {
                const conn = this.ctx.connections[seg.wireId];
                if (conn) {
                    wireColor = cssColorFromHash(`${conn.fromPort}-${conn.toPort}`);

                    const fromNode = this.ctx.nodes[conn.fromNodeId];
                    const toNode = this.ctx.nodes[conn.toNodeId];
                    if (fromNode && toNode) {
                        const absFrom = this.getAbsolutePortY(fromNode, conn.fromPort.toString(), false);
                        const absTo = this.getAbsolutePortY(toNode, conn.toPort.toString(), true);

                        // Determine Node Top in Pixels
                        const segAbsY = gridAbsY; // Re-use

                        const TOLERANCE_PX = 12; // Snap if within 12px (half row)

                        const isStart = seg.type === 'start';
                        const isEnd = seg.type === 'end';

                        if (isStart && absFrom !== undefined) {
                            targetAbsY = absFrom;
                        } else if (isEnd && absTo !== undefined) {
                            targetAbsY = absTo;
                        } else {
                            // Fallback for mid-segments
                            if (absFrom !== undefined && Math.abs(segAbsY - absFrom) <= TOLERANCE_PX) {
                                targetAbsY = absFrom;
                            } else if (absTo !== undefined && Math.abs(segAbsY - absTo) <= TOLERANCE_PX) {
                                targetAbsY = absTo;
                            }
                        }
                    }
                }
            }

            const selected = this.ctx.selection.has(seg.wireId);
            const color = wireColor;

            const gridCol = seg.x + 2;

            let gridRow = 0;
            let yOffsetPx = 0;

            // Base Grid Row calculation (2 * slot + 2).
            const baseNodeRow = logicalSlot * 2 + 2;

            if (rem < GAP_LANE_INDEX) {
                // Node Row (0..30)
                gridRow = baseNodeRow;
                yOffsetPx = 16 + (rem * 24);
            } else {
                // Gap Row (31)
                gridRow = baseNodeRow + 1;
                yOffsetPx = 9; // Center of 16px
            }

            let rowTopAbs = 0;
            // Resolve Target Logic (Override if direct connection to Port)
            if (targetAbsY !== undefined) {
                // Align to Port Absolute
                const isGap = (rem === GAP_LANE_INDEX);

                const storedOffset = this.ctx.gridMetrics.rowOffsets.get(logicalSlot);
                if (storedOffset !== undefined) {
                    if (isGap) {
                        rowTopAbs = storedOffset + (h || 80);
                    } else {
                        rowTopAbs = storedOffset;
                    }
                } else {
                    // Fallback
                    const pairTop = 16 + (logicalSlot * 96);
                    rowTopAbs = isGap ? (pairTop + 80) : pairTop;
                }

                // CRITICAL: Only snap Trace H-Line to Port if deviation is small (< 3px)
                // Otherwise, keep Trace at Logical Y and use Jog to connect.
                const diff = targetAbsY - gridAbsY;
                if (Math.abs(diff) < 3) {
                    yOffsetPx = (targetAbsY - 1) - rowTopAbs;
                }
            }

            const visualOffset = yOffsetPx;
            const verticalJog = 0;
            const portLevel = 0;

            let style = `grid-column: ${gridCol} / span ${seg.length}; grid-row: ${gridRow} / span 1; position: relative; width: 100%; height: 100%;`;

            // Calculate Trim based on Context
            let leftTrim = 0;
            let rightTrim = 0;

            if (seg.wireId) {
                const conn = this.ctx.connections[seg.wireId];
                if (conn) {
                    const fromNode = this.ctx.nodes[conn.fromNodeId];
                    const toNode = this.ctx.nodes[conn.toNodeId];
                    if (fromNode && toNode) {
                        const logicFromX = fromNode.x * 2 + 1;
                        const logicToX = toNode.x * 2 + 1;

                        const fromRow = fromNode.y * 2 + 2;
                        const toRow = toNode.y * 2 + 2;
                        const segRow = gridRow;

                        const isFromRow = Math.abs(segRow - fromRow) < 1.0;
                        const isToRow = Math.abs(segRow - toRow) < 1.0;

                        const fromNodeTop = this.ctx.gridMetrics.rowOffsets.get(fromNode.y) ?? (16 + (fromNode.y * 96));
                        const toNodeTop = this.ctx.gridMetrics.rowOffsets.get(toNode.y) ?? (16 + (toNode.y * 96));

                        const absFrom = this.getAbsolutePortY(fromNode, conn.fromPort.toString(), false);
                        const absTo = this.getAbsolutePortY(toNode, conn.toPort.toString(), true);

                        const fromVisualOffset = (absFrom !== undefined) ? (absFrom - fromNodeTop) : -999;
                        const toVisualOffset = (absTo !== undefined) ? (absTo - toNodeTop) : -999;

                        const isFromAligned = Math.abs(visualOffset - fromVisualOffset) < 10.0;
                        const isToAligned = Math.abs(visualOffset - toVisualOffset) < 10.0;

                        const isAfterSource = fromNode && seg.x === logicFromX + 1 && isFromRow && isFromAligned;
                        const isBeforeDest = toNode && seg.x === logicToX - 1 && isToRow && isToAligned;

                        if (isAfterSource) leftTrim = 0;
                        if (isBeforeDest) rightTrim = 0;
                    }
                }
            }

            // Helper to resolve Rem to Px (Context Aware)
            const resolveClip = (r: number | undefined, isGapRow: boolean) => {
                if (r === undefined) return undefined;

                if (isGapRow) {
                    // Gap Row Context (Height 16px)
                    if (r === GAP_LANE_INDEX) return 8;
                    return 0;
                } else {
                    // Context: Node Row (Variable Height)
                    if (r === -1) return 0; // Top of Cell (connected to Gap above)

                    if (r < GAP_LANE_INDEX) {
                        return 15 + (r * 24);
                    }
                    if (r === GAP_LANE_INDEX) {
                        // Target Gap
                        return (h !== undefined && h > 0) ? h + 8 : 0;
                    }
                    return 8; // Fallback
                }
            };

            const isGapRow = (rem === GAP_LANE_INDEX);
            const clipTopPx = resolveClip(seg.clipTopRem, isGapRow);
            const clipBotPx = resolveClip(seg.clipBotRem, isGapRow);

            // Debug Log
            // console.log(`WireSeg[${seg.id}] Type=${seg.type} X=${seg.x} Y=${seg.y.toFixed(2)} AbsY=${gridAbsY} Off=${yOffsetPx} Row=${gridRow} ClipT=${clipTopPx} ClipB=${clipBotPx}`);

            // Inner Line Rendering Helpers
            const renderH = (extraStyle: string = '') => {
                return html`<div class="wire-line" style="position: absolute; height: 2px; top: 0; transform: translateY(${yOffsetPx}px); --wire-color: ${color}; ${extraStyle}"></div>`;
            };

            const renderV = () => {
                let top = '0';
                let height = '100%';
                if (clipTopPx !== undefined) {
                    top = `${clipTopPx}px`;
                    if (clipBotPx !== undefined) {
                        height = `${clipBotPx - clipTopPx}px`;
                    } else {
                        height = `calc(100% - ${clipTopPx}px)`;
                    }
                } else if (clipBotPx !== undefined) {
                    height = `${clipBotPx}px`;
                }

                return html`<div class="wire-line vertical" style="position: absolute; width: 2px; height: ${height}; left: calc(50% - 1px); top: ${top}; --wire-color: ${color};"></div>`;
            };

            const renderCornerH_Left = (trim: number) => html`<div class="wire-line" style="position: absolute; height: 2px; top: 0; transform: translateY(${yOffsetPx}px); --wire-color: ${color}; left: ${trim}px; width: calc(50% - ${trim}px);"></div>`;
            const renderCornerH_Right = (trim: number) => html`<div class="wire-line" style="position: absolute; height: 2px; top: 0; transform: translateY(${yOffsetPx}px); --wire-color: ${color}; left: 50%; width: calc(50% - ${trim}px);"></div>`;

            const renderCornerV_Top = () => {
                let top = '0';
                let h = yOffsetPx;
                if (clipTopPx !== undefined) {
                    top = `${clipTopPx}px`;
                    h = yOffsetPx - clipTopPx + 2;
                }
                return html`<div class="wire-line vertical" style="position: absolute; width: 2px; height: ${h}px; left: calc(50% - 1px); top: ${top}; --wire-color: ${color};"></div>`;
            };

            const renderCornerV_Bottom = () => {
                let h = `calc(100% - ${yOffsetPx}px)`;
                if (clipBotPx !== undefined) {
                    h = `${clipBotPx - yOffsetPx + 3}px`;
                }
                return html`<div class="wire-line vertical" style="position: absolute; width: 2px; height: ${h}; left: calc(50% - 1px); top: ${yOffsetPx}px; --wire-color: ${color};"></div>`;
            };

            const clampTrim = (val: number, isCorner: boolean) => isCorner ? Math.min(val, 7) : val;

            let lines = html``;

            const renderJog = (isEnd: boolean) => {
                if (targetAbsY === undefined) return null;
                const diff = targetAbsY - gridAbsY;
                if (Math.abs(diff) < 3) return null;

                // Relative Calculations
                // Trace Y (relative to Cell Top) = yOffsetPx
                // Target Y (relative to Cell Top) = targetAbsY - rowTopAbs
                const traceY = yOffsetPx;
                const targetY = targetAbsY - rowTopAbs;

                const top = Math.min(traceY, targetY);
                const h = Math.abs(traceY - targetY);

                const left = isEnd ? `0` : `calc(100% - 2px)`;

                return html`<div class="wire-line vertical jog" style="position: absolute; width: 2px; height: ${h}px; left: ${left}; top: ${top}px; --wire-color: ${color};"></div>`;
            };

            if (seg.type === 'h') {
                lines = renderH(`width: calc(100% - ${leftTrim + rightTrim}px); left: ${leftTrim}px;`);
            }
            else if (seg.type === 'v') {
                lines = renderV();
            }
            else if (seg.type === 'start') {
                const jog = renderJog(false);
                const nodeColIndex = (seg.x - 1) / 2;
                const cellWidth = this.ctx.gridMetrics.columnWidths.get(nodeColIndex) || 272;
                let nodeWidth = 272;
                if (seg.wireId) {
                    const conn = this.ctx.connections[seg.wireId];
                    if (conn) {
                        const node = this.ctx.nodes[conn.fromNodeId];
                        if (node) {
                            const metric = this.ctx.gridMetrics.cells.get(`${node.x},${node.y}`);
                            if (metric) nodeWidth = metric.width;
                        }
                    }
                }
                if (cellWidth > nodeWidth) {
                    const halfNode = nodeWidth / 2;
                    lines = html`${jog}${renderH(`left: calc(50% + ${halfNode}px); width: calc(50% - ${halfNode}px);`)}`;
                } else {
                    if (jog) lines = jog;
                    else lines = html``;
                }
            }
            else if (seg.type === 'end') {
                const jog = renderJog(true);
                const nodeColIndex = (seg.x - 1) / 2;
                const cellWidth = this.ctx.gridMetrics.columnWidths.get(nodeColIndex) || 272;
                let nodeWidth = 272;
                if (seg.wireId) {
                    const conn = this.ctx.connections[seg.wireId];
                    if (conn) {
                        const node = this.ctx.nodes[conn.toNodeId];
                        if (node) {
                            const metric = this.ctx.gridMetrics.cells.get(`${node.x},${node.y}`);
                            if (metric) nodeWidth = metric.width;
                        }
                    }
                }
                if (cellWidth > nodeWidth) {
                    const halfNode = nodeWidth / 2;
                    lines = html`${jog}${renderH(`left: 0; width: calc(50% - ${halfNode}px);`)}`;
                } else {
                    if (jog) lines = jog;
                    else lines = html``;
                }
            }
            else if (seg.type === 'ctl') {
                const t = clampTrim(rightTrim, true);
                lines = html`${renderCornerH_Right(t)}${renderCornerV_Bottom()}`;
            }
            else if (seg.type === 'ctr') {
                const t = clampTrim(leftTrim, true);
                lines = html`${renderCornerH_Left(t)}${renderCornerV_Bottom()}`;
            }
            else if (seg.type === 'cbl') {
                const t = clampTrim(rightTrim, true);
                lines = html`${renderCornerH_Right(t)}${renderCornerV_Top()}`;
            }
            else if (seg.type === 'cbr') {
                const t = clampTrim(leftTrim, true);
                lines = html`${renderCornerH_Left(t)}${renderCornerV_Top()}`;
            }

            const isEndpoint = seg.type === 'start' || seg.type === 'end';
            const endpointStyle = isEndpoint ? 'pointer-events: none !important;' : '';

            return html`
                <div class="wire-segment ${seg.type} ${selected ? 'selected' : ''}"
                     id="${seg.id}"
                     data-wire-id="${seg.wireId}"
                     data-jog="${verticalJog}"
                     data-wire-level="${visualOffset}"
                     data-port-level="${portLevel}"
                     style="${style} ${endpointStyle}"
                     @click=${(e: MouseEvent) => {
                    if (isEndpoint) return;
                    e.stopPropagation();
                    this.ctx.onWireClick(seg.wireId, e);
                }}
                     @dblclick=${(e: MouseEvent) => {
                    if (isEndpoint) return;
                    e.stopPropagation();
                    this.ctx.onWireDblClick(seg.wireId, e);
                }}
                >
                    ${lines}
                </div>
            `;
        });
    }

    private getAbsolutePortY(node: GridNode, portName: string, isInput: boolean): number | undefined {
        let index = -1;

        // Always fetch Repo Type for Body Height calculations and fallback
        const repoType = defaultNodeRepository.getNodeType(node.config.typeId);

        // Retrieve Cached Effective Ports (Single Source of Truth)
        // Uses global cache from LocalController passed via Context
        const effectiveType = this.ctx.effectiveNodeTypes?.get(node.id);

        let ports: PortHint[] | undefined;

        if (!effectiveType) {
            // Fallback: This should ideally not happen if LocalController initializes correctly.
            ports = isInput ? repoType?.inputs : repoType?.outputs;

            if (ports && Array.isArray(ports)) {
                index = ports.findIndex(p => p.name === portName);
            }
        } else {
            ports = isInput ? effectiveType.inputs : effectiveType.outputs;
            index = ports.findIndex(p => p.name === portName);
        }

        if (index === -1) {
            // Numeric Fallback (e.g. Dynamic Ports or Legacy)
            if (ports) {
                const i = parseInt(portName, 10);
                if (!isNaN(i) && i >= 0 && i < ports.length) index = i;
            }
            if (index === -1 && !isNaN(parseInt(portName, 10))) {
                // Pure numeric index fallback (legacy wires)
                index = parseInt(portName, 10);
            }
        }

        if (index === -1) return undefined;

        // Base Calculation: Top of Row + Visual Layout from node-width-utils
        const rowTopAbs = this.ctx.gridMetrics.rowOffsets.get(node.y);

        if (rowTopAbs === undefined) return undefined;

        // Apply Centering Offset
        // If Row Height > Node Height, the node is centered.
        // We use the CACHED node height from GridMetrics to avoid expensive re-calc.
        const rowHeight = this.ctx.gridMetrics.rows.get(node.y) || 80;

        // Look up cached cell metric
        const cellKey = `${node.x},${node.y}`;
        const cellMetric = this.ctx.gridMetrics.cells.get(cellKey);
        const nodeHeight = cellMetric ? cellMetric.height : 80; // Fallback to 80 if not ready

        let centeringOffset = 0;
        if (rowHeight > nodeHeight) {
            centeringOffset = (rowHeight - nodeHeight) / 2;
        }

        // Special Case: IO Nodes (Pill Shape) -> Center vertically (20px relative to Node Top)
        if (
            node.config.typeId === 'io.input' ||
            node.config.typeId === 'io.output' ||
            node.config.typeId === 'resolume.input' ||
            node.config.typeId === 'resolume.output'
        ) {
            return rowTopAbs + centeringOffset + 20;
        }

        // Formula: RowTop + CenteringOffset + Header(24) + Pad(2) + (Index * 24) + Pip(12)
        // calculatePortY logic: 24 + 2 + (index * 24) + 12
        return rowTopAbs + centeringOffset + calculatePortY(index);
    }

}
