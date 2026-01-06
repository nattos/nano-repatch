import { HTMLTemplateResult } from 'lit';
import { observable, makeObservable, action, runInAction, toJS } from 'mobx';
import { LayoutResult } from '../layout/wire-layout';
import { GraphState, GridNode, Connection, AppController } from './state';
import { settingsManager } from './settings-manager';
import { StructorType } from '../structor/structor';
import {
  defaultNodeRepository,
  PortHint,
  RegionVisibility
} from '../structor/repository';
import {
  NODE_WIDTH_NORMAL, NODE_WIDTH_MINIMAL, NODE_WIDTH_COMPRESSED,
  GRID_MIN_COLS, GRID_OUTPUT_COL_PADDING
} from '../constants';
import { getNodeVisualState, NodeVisualState, calculateNodeHeight } from '../utils/node-width-utils';

export interface LocalState {
  selection: Map<string, Selectable>;
  queuedSelection: Set<string>;
  lastGroupSelection: Set<string> | null;
  inflightPortConnectionOperation: { nodeId: string; port: string; type: 'in' | 'out'; } | null;
  loadedSubgraphs: Map<string, GraphState>;
  compiledNodeConfigs: Map<string, any>; // Cache for worker-compiled configs
  inferredNodeTypes: Map<string, { inputs: StructorType, outputs: StructorType }>;
  effectiveNodeTypes: Map<string, { inputs: PortHint[], outputs: PortHint[] }>; // Cache for resolved UI Ports

  gridMetrics: GridMetrics; // Comprehensive Grid State
  wireLayout: LayoutResult;
  layoutVersion: number;
  viewport: { x: number, y: number, w: number, h: number };
  dragPreview: { x: number, y: number, w: number, h: number } | null;

  clipboard: { nodes: GridNode[]; connections: Connection[] } | null;

  // Interaction State
  isDraggingSelection: boolean;
  altKeyPressed: boolean;

  // Serialized settings.
  localSettings: LocalSettings;
}

// Serialized settings.
export interface LocalSettings {
  showDebugValues: boolean;
  activeTab: string | null;
  enableResolumeIO: boolean;
}

export interface Selectable {
  path: string;
  renderInspectorContent?(): HTMLTemplateResult | undefined;
}

export interface SelectableHandle {
  select(): void;
}

export interface CellMetric {
  width: number;
  height: number;
  visualState: NodeVisualState;
  portInputCount: number;
  portOutputCount: number;
  isHidden?: boolean;
}

export interface GridMetrics {
  cells: Map<string, CellMetric>; // Key "x,y"
  columns: Map<number, NodeVisualState>; // Column Index -> Widest State
  columnWidths: Map<number, number>; // Column Index -> Max Width in px
  rows: Map<number, number>; // Row Index -> Max Height in px
  rowOffsets: Map<number, number>; // Row Index -> Accum. Pixels from Top (for Node Top)
  colOffsets: Map<number, number>; // Col Index -> Accum. Pixels from Left (for Node Left)
  boundingBox: { width: number; height: number }; // Global grid dimensions in cells
  regions: Map<string, { x: number; y: number; width: number; height: number; isCollapsed: boolean }>; // Cached region bounds
}

export class LocalController {
  public observableState: LocalState;
  public settingsLoaded: Promise<void>;


  private layoutWorker: Worker;

  constructor(private appController: AppController) {
    this.observableState = observable({
      selection: new Map<string, Selectable>(),
      queuedSelection: new Set<string>(),
      lastGroupSelection: null,
      inflightPortConnectionOperation: null,
      loadedSubgraphs: new Map<string, GraphState>(),
      compiledNodeConfigs: new Map<string, any>(),
      wireLayout: { wires: {}, segments: [] },
      layoutVersion: 0,

      inferredNodeTypes: new Map<string, { inputs: any, outputs: any }>(), // Initialize the new map
      effectiveNodeTypes: new Map<string, { inputs: PortHint[], outputs: PortHint[] }>(),
      viewport: { x: 0, y: 0, w: 0, h: 0 },
      dragPreview: null,
      clipboard: null,
      gridMetrics: {
        cells: new Map(),
        columns: new Map(),
        columnWidths: new Map(),
        rows: new Map(),
        rowOffsets: new Map(),
        colOffsets: new Map(),
        boundingBox: { width: 0, height: 0 },
        regions: new Map()
      },
      localSettings: {
        showDebugValues: false,
        activeTab: 'library',
        enableResolumeIO: false
      },
      // Interaction State
      isDraggingSelection: false,
      altKeyPressed: false,
    });
    makeObservable(this);

    // Initialize Worker
    this.layoutWorker = new Worker(new URL('../workers/wire-layout.worker.ts', import.meta.url), {
      type: 'module'
    });

    this.layoutWorker.onmessage = (event) => {
      const { type, layout } = event.data;
      if (type === 'LAYOUT_RESULT') {
        runInAction(() => {
          this.observableState.wireLayout = layout;
          this.observableState.layoutVersion++;
        });
      }
    };

    this.settingsLoaded = this.loadSettings();
  }

  public initializeInferredTypes(graph: GraphState) {
    if (graph.inner.inferredNodeTypes) {
      runInAction(() => {
        for (const [nodeId, types] of Object.entries(graph.inner.inferredNodeTypes!)) {
          this.observableState.inferredNodeTypes.set(nodeId, types);
          this.recomputeEffectivePorts(nodeId, graph.inner.nodes[nodeId]?.config.typeId);
        }
      });
    }
  }

  @action
  public updateInferredTypes(inferredTypes: Record<string, { inputs: StructorType, outputs: StructorType }>, typeLookup: (nodeId: string) => string | undefined) {
    for (const [nodeId, types] of Object.entries(inferredTypes)) {
      this.observableState.inferredNodeTypes.set(nodeId, types);

      const typeId = typeLookup(nodeId);
      if (typeId) {
        this.recomputeEffectivePorts(nodeId, typeId);
      }
    }
  }

  // --- Port Computation (Single Source of Truth) ---
  @action
  public recomputeEffectivePorts(nodeId: string, typeId: string): void {
    if (!typeId) return;

    const nodeType = defaultNodeRepository.getNodeType(typeId);
    const inferredType = this.observableState.inferredNodeTypes.get(nodeId);

    // Default: Use Repository
    let inputs: PortHint[] = nodeType?.inputs ? [...nodeType.inputs] : [];
    let outputs: PortHint[] = nodeType?.outputs ? [...nodeType.outputs] : [];

    // Logic: Inferred > Repository
    // If Inferred exists and is valid (Record with fields), it becomes the Primary Source.

    // 1. Outputs
    if (inferredType && inferredType.outputs && (inferredType.outputs as any).kind === 'record' && (inferredType.outputs as any).fields) {
      const fields = (inferredType.outputs as any).fields;
      // Only override if fields exist
      if (Object.keys(fields).length > 0) {
        outputs = Object.entries(fields).map(([name, type]) => {
          // Try to match with Repo Metadata
          const repoPort = nodeType?.outputs?.find(p => p.name === name);
          return {
            name,
            type: type as StructorType,
            description: repoPort?.description || name,
            ...repoPort // Spread other props like suppressLabel
          };
        });
      }
    }

    // 2. Inputs Strategy: Inferred Source of Truth
    if (inferredType && inferredType.inputs && (inferredType.inputs as any).kind === 'record' && (inferredType.inputs as any).fields) {
      const fields = (inferredType.inputs as any).fields;
      // Strict Replacement: The inferred type definition is the authoritative source for inputs.
      // We map these fields to ports, pulling metadata (description, etc.) from the Repository definition if available.
      if (Object.keys(fields).length > 0) {
        inputs = Object.entries(fields).map(([name, type]) => {
          const repoPort = nodeType?.inputs?.find(p => p.name === name);
          // Safety: type might be undefined if compilation failed or intermediate state
          if (!type) {
            console.warn(`[LocalController] Inferred input '${name}' for node '${nodeId}' has undefined type.`);
            return {
              name,
              type: { kind: 'atomic', type: 'any' } as StructorType,
              description: repoPort?.description || name,
              defaultValue: repoPort?.defaultValue,
              ...repoPort
            };
          }

          return {
            name,
            type: type as StructorType,
            description: repoPort?.description || name,
            defaultValue: (type as any).defaultValue ?? repoPort?.defaultValue,
            ...repoPort // Spread other props like suppressLabel
          };
        });
      } else {
        inputs = [];
      }
    }
    // Else: Keep inputs as Repo inputs (default)

    // Sort: Repo Order first, then New Ports Alphabetical
    if (nodeType?.inputs) {
      inputs.sort((a, b) => {
        const idxA = nodeType.inputs!.findIndex(p => p.name === a.name);
        const idxB = nodeType.inputs!.findIndex(p => p.name === b.name);

        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1; // A in Repo, B New -> A first
        if (idxB !== -1) return 1;  // B in Repo, A New -> B first

        // Both New: Respect insertion order (don't sort alphabetically)
        return 0;
      });
    }

    this.observableState.effectiveNodeTypes.set(nodeId, { inputs, outputs });
  }

  private async loadSettings() {
    const loaded = await settingsManager.loadSettings();
    if (loaded) {
      runInAction(() => {
        this.observableState.localSettings = {
          ...this.observableState.localSettings,
          ...loaded
        };
      });
    }

  }

  private saveSettings() {
    settingsManager.saveSettings(toJS(this.observableState.localSettings));
  }

  @action
  public updateWireLayout(graph: GraphState): void {
    const { nodes, connections } = graph.inner;

    // 1. Synchronously update metrics so the App has correct sizes immediately
    this.updateGridMetrics(graph);

    // 2. Prepare payload for worker
    // We virtualize Input/Output columns to align with WireRenderer logic.
    // CSS Grid: 1=Input, 2=Gap, 3=Node0 (x=0).
    // WireRenderer expects: seg.x + 2 = GridCol.
    // So for Input (Col 1), we need seg.x = -1.
    // For Output (Col Last), we need seg.x relative to max.

    // Find grid bounds
    // Optimized: Use cached bounding box from updateGridMetrics (called above)
    const maxNodeX = this.observableState.gridMetrics.boundingBox.width;

    const getVirtualX = (n: GridNode) => {
      if (n.config.typeId === 'io.input' || n.config.typeId === 'resolume.input') return -1;
      // Output needs to be far enough right.
      // If Nodes go up to maxNodeX.
      // GraphGrid uses `const cols = Math.max(maxNodeX + GRID_OUTPUT_COL_PADDING, GRID_MIN_COLS);`
      // So we should match that padding logic.
      if (n.config.typeId === 'io.output' || n.config.typeId === 'resolume.output') return Math.max(maxNodeX + GRID_OUTPUT_COL_PADDING, GRID_MIN_COLS);
      return n.x;
    };

    const obstacles = Object.values(nodes).map(n => {
      let portCount = 1; // Default min height

      const effective = this.observableState.effectiveNodeTypes.get(n.id);
      if (effective) {
        portCount = Math.max(effective.inputs.length, effective.outputs.length);
      } else {
        const type = defaultNodeRepository.getNodeType(n.config.typeId);
        if (type) {
          const i = type.inputs?.length || 0;
          const o = type.outputs?.length || 0;
          portCount = Math.max(i, o);
        }
      }

      return { x: getVirtualX(n), y: n.y, height: portCount + 1 };
    });


    const wires = Object.values(connections).map(c => {
      const fromNode = nodes[c.fromNodeId];
      const toNode = nodes[c.toNodeId];

      if (!fromNode || !toNode) {
        // Guard against deleted nodes mid-update
        return null;
      }

      let startOffset = 1; // Default to 'mid'ish
      let endOffset = 1;

      // Helper to find index
      const getPortIndex = (node: GridNode, portName: string, isInput: boolean) => {
        // Retrieve Cached Effective Ports (Single Source of Truth)
        const effectiveType = this.observableState.effectiveNodeTypes.get(node.id);
        if (!effectiveType) {
          // Fallback (Should rarely happen if initialized correctly)
          const repoType = defaultNodeRepository.getNodeType(node.config.typeId);
          const ports = isInput ? repoType?.inputs : repoType?.outputs;
          if (ports) {
            const idx = ports.findIndex(p => p.name === portName);
            if (idx !== -1) return idx;
          }
          // Numeric fallback
          const i = parseInt(portName, 10);
          if (!isNaN(i)) return i;
          return -1;
        }
        const ports = isInput ? effectiveType.inputs : effectiveType.outputs;
        return ports.findIndex(p => p.name === portName);
      };

      const fromIdx = getPortIndex(fromNode, c.fromPort.toString(), false);
      const toIdx = getPortIndex(toNode, c.toPort.toString(), true);

      // Calculate Centering Offsets
      // Mirrors WireRenderer logic
      const getCenteringOffset = (node: GridNode) => {
        const rowHeight = this.observableState.gridMetrics.rows.get(node.y) || 80;
        // Re-calculate node height or cache it?
        // Ideally cache in gridMetrics.cells, but here we can re-calc or lookup.
        // Lookup from cells is safer if populated.
        const cell = this.observableState.gridMetrics.cells.get(`${node.x},${node.y}`);
        const nodeHeight = cell ? cell.height : 80;

        if (rowHeight > nodeHeight) {
          return (rowHeight - nodeHeight) / 2;
        }
        return 0;
      };

      const fromCenter = getCenteringOffset(fromNode);
      const toCenter = getCenteringOffset(toNode);

      // Calculate Logical Lane Offset (Rem)
      // Formula: rem = index + Math.round((centeringOffset + 23) / 24)
      // Fallback: If port not found (idx -1), default to 0 (Main/Top Port) to respect centering.

      const startBaseIndex = fromIdx === -1 ? 0 : fromIdx;
      startOffset = startBaseIndex + Math.round((fromCenter + 23) / 24);

      const endBaseIndex = toIdx === -1 ? 0 : toIdx;
      endOffset = endBaseIndex + Math.round((toCenter + 23) / 24);

      // console.log(`WireDef: ${c.id} From=${fromNode?.config.typeId}:${c.fromPort} Offset=${startOffset} To=${toNode?.config.typeId}:${c.toPort} Offset=${endOffset}`);

      return {
        id: c.id,
        start: { x: getVirtualX(fromNode), y: fromNode.y },
        end: { x: getVirtualX(toNode), y: toNode.y },
        fromPort: c.fromPort.toString(),
        toPort: c.toPort.toString(),
        startOffset,
        endOffset
      };
    }).filter(w => w !== null) as any[]; // TODO: Import WireDef properly if needed, trusting type inference for now or casting

    // Send to worker
    this.layoutWorker.postMessage({
      type: 'LAYOUT_REQUEST',
      wires,
      options: { obstacles }
    });
  }

  @action
  public updateGridMetrics(graph: GraphState): void {
    const { nodes, connections } = graph.inner;

    const metrics: GridMetrics = {
      cells: new Map(),
      columns: new Map(),
      columnWidths: new Map(),
      rows: new Map(),
      rowOffsets: new Map(),
      colOffsets: new Map(),
      boundingBox: { width: 0, height: 0 },
      regions: new Map()
    };

    // --- Region Collapse Pre-Calculation ---
    const rowStats = new Map<number, { regionCount: number, collapsedCount: number, contentCount: number }>();
    const colStats = new Map<number, { regionCount: number, collapsedCount: number, contentCount: number }>();
    const hiddenCellsY = new Map<number, Set<number>>(); // Map<y, Set<x>>

    const getRowStats = (y: number) => {
      if (!rowStats.has(y)) rowStats.set(y, { regionCount: 0, collapsedCount: 0, contentCount: 0 });
      return rowStats.get(y)!;
    }
    const getColStats = (x: number) => {
      if (!colStats.has(x)) colStats.set(x, { regionCount: 0, collapsedCount: 0, contentCount: 0 });
      return colStats.get(x)!;
    }

    const cachedRegions = new Map<string, { x: number, y: number, width: number, height: number, isCollapsed: boolean }>();
    let maxGridX = 0;
    let maxGridY = 0;

    Object.values(nodes).forEach(node => {
      // Update max extents for regular nodes
      if (node.config.typeId !== 'io.output' && node.config.typeId !== 'resolume.output') {
        if (node.x > maxGridX) maxGridX = node.x;
        if (node.y > maxGridY) maxGridY = node.y;
      }

      const type = defaultNodeRepository.getNodeType(node.config.typeId);
      if (type?.getRegion) {
        const region = type.getRegion(node.config);
        if (region) {
          // Region bounds relative to node
          const x = node.x + (region.x ?? 0);
          const y = node.y + (region.y ?? 0);
          const { width, height } = region;

          // Check Visibility
          // Safe access via getRegion contract
          const isCollapsed = region.visibility === RegionVisibility.Hide;

          cachedRegions.set(node.id, { x, y, width, height, isCollapsed });

          // Update global bounds
          // Region extends from x to x + width (exclusive in loop, inclusive in grid size?)
          // Grid uses 0-based indices. If a region occupies column 5, x=5, w=1.
          // It ends at x+w-1 = 5. Max index is 5.
          const extentX = x + width - 1;
          const extentY = y + height - 1;

          if (extentX > maxGridX) maxGridX = extentX;
          if (extentY > maxGridY) maxGridY = extentY;

          for (let rx = x; rx < x + width; rx++) {
            const cStats = getColStats(rx);
            for (let ry = y; ry < y + height; ry++) {
              // Exclude parent node cell (which is usually at x,y)
              if (rx === node.x && ry === node.y) continue;

              const rStats = getRowStats(ry);
              rStats.regionCount++;
              cStats.regionCount++;

              if (isCollapsed) {
                rStats.collapsedCount++;
                cStats.collapsedCount++;

                if (!hiddenCellsY.has(ry)) {
                  hiddenCellsY.set(ry, new Set());
                }
                hiddenCellsY.get(ry)!.add(rx);
              }
            }
          }
        }
      }
    });

    metrics.boundingBox = { width: maxGridX, height: maxGridY };
    metrics.regions = cachedRegions;

    // 2. Iterate Nodes to populate Content Count
    Object.values(nodes).forEach(node => {
      const isHidden = hiddenCellsY.get(node.y)?.has(node.x);
      // If node is NOT in hiddenCells, it is visible content.
      if (!isHidden) {
        getRowStats(node.y).contentCount++;
        getColStats(node.x).contentCount++;
      }
    });

    // Pre-calculate incoming connections for all nodes to perform heuristic
    const incomingConnections = new Map<string, Set<string>>();
    Object.values(connections).forEach(c => {
      if (!incomingConnections.has(c.toNodeId)) {
        incomingConnections.set(c.toNodeId, new Set());
      }
      incomingConnections.get(c.toNodeId)!.add(c.toPort.toString());
    });

    Object.values(nodes).forEach(node => {
      const col = node.x;
      const row = node.y;
      const key = `${col},${row}`;

      // Determine Node Properties
      const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
      // Use Effective Types (Single Source of Truth)
      const effective = this.observableState.effectiveNodeTypes.get(node.id); // Ensure this is up to date!

      let inputs: PortHint[] = effective?.inputs || (nodeType?.inputs ? [...nodeType.inputs] : []);
      let outputs: PortHint[] = effective?.outputs || (nodeType?.outputs ? [...nodeType.outputs] : []);

      const connectedPorts = incomingConnections.get(node.id) || new Set<string>();
      const hasCustomBody = !!(nodeType?.renderBody || nodeType?.ui?.body);

      // Helper logic from node-width-utils
      const state = getNodeVisualState(inputs, outputs, connectedPorts, hasCustomBody, node.config);

      let width = NODE_WIDTH_NORMAL;
      // If node defines a region, 'width' property refers to Region Grid Width (e.g. 2 columns),
      // NOT pixel width. So we should ignore it for visual sizing.
      const isRegionNode = !!nodeType?.getRegion;

      if (node.config.width && !isRegionNode) {
        width = node.config.width;
      } else {
        if (state === 'minimal') width = NODE_WIDTH_MINIMAL;
        else if (state === 'compressed') width = NODE_WIDTH_COMPRESSED;
        else if (state === 'pill') width = NODE_WIDTH_COMPRESSED; // 176px - Pill usually wider than minimal?
        else width = NODE_WIDTH_NORMAL;
      }

      const isHidden = hiddenCellsY.get(node.y)?.has(node.x);

      // Calculate Height using shared utility
      const estimatedHeight = calculateNodeHeight(
        node,
        nodeType,
        connectedPorts,
        inputs,
        outputs
      );

      metrics.cells.set(key, {
        width,
        height: estimatedHeight,
        visualState: state,
        portInputCount: inputs.length,
        portOutputCount: outputs.length,
        isHidden
      });

      // Column Metrics
      const currentWidth = metrics.columnWidths.get(col) || 0;
      if (width > currentWidth) metrics.columnWidths.set(col, width);

      // Column Visual State Priority: Normal > Compressed > Minimal
      const currentState = metrics.columns.get(col) || 'minimal';
      if (state === 'normal') metrics.columns.set(col, 'normal');
      else if (state === 'compressed' && currentState !== 'normal') metrics.columns.set(col, 'compressed');
      else if (state === 'minimal' && !metrics.columns.has(col)) metrics.columns.set(col, 'minimal');

      // Row Metrics
      const currentRowHeight = metrics.rows.get(row) || 0;
      if (estimatedHeight > currentRowHeight) metrics.rows.set(row, estimatedHeight);
    });

    try {
      // Post-Process: Apply Hiding Logic for Rows
      const maxRow = Math.max(...Array.from(metrics.rows.keys()), ...Array.from(rowStats.keys()), -1);
      for (let r = 0; r <= maxRow; r++) {
        const stats = rowStats.get(r);
        let isHidden = false;
        if (stats) {
          if (stats.contentCount === 0 && stats.regionCount > 0 && stats.regionCount === stats.collapsedCount) {
            isHidden = true;
          }
        }
        if (isHidden) {
          metrics.rows.set(r, 0);
        }
      }

      // Post-Process: Apply Hiding Logic for Columns
      const maxCol = Math.max(...Array.from(metrics.columnWidths.keys()), ...Array.from(colStats.keys()), -1);
      for (let c = 0; c <= maxCol; c++) {
        const stats = colStats.get(c);
        let isHidden = false;
        if (stats) {
          if (stats.contentCount === 0 && stats.regionCount > 0 && stats.regionCount === stats.collapsedCount) {
            isHidden = true;
          }
        }
        if (isHidden) {
          metrics.columnWidths.set(c, 0);
        }
      }

      // Post-Process: Calculate Row Offsets
      let currentY = 16;
      for (let r = 0; r <= maxRow; r++) {
        metrics.rowOffsets.set(r, currentY);
        let h = metrics.rows.get(r);
        if (h === undefined) h = 80;

        const gap = h > 0 ? 16 : 0;
        currentY += h + gap;
      }
      // Post-Process: Calculate Col Offsets
      // Approximation: Input Col 80px + Gap 16px
      let currentX = 96;
      for (let c = 0; c <= maxCol; c++) {
        metrics.colOffsets.set(c, currentX);
        let w = metrics.columnWidths.get(c);
        if (w === undefined) w = 80; // Default width for empty column

        const gap = w > 0 ? 16 : 0;
        currentX += w + gap;
      }
    } catch (e) {
      console.error("Error calculating rowOffsets", e);
    }

    this.observableState.gridMetrics = metrics;
  }

  public defineSelectable(selectable: Selectable): SelectableHandle {
    // If this path is in the queue, promote it to selection immediately
    if (this.observableState.queuedSelection.has(selectable.path)) {
      this.observableState.queuedSelection.delete(selectable.path);
      runInAction(() => {
        this.observableState.selection.set(selectable.path, selectable);
      });
    }

    // If this path is ALREADY selected, update the selectable instance
    // (e.g. if the component re-rendered with new data)
    if (this.observableState.selection.has(selectable.path)) {
      runInAction(() => {
        this.observableState.selection.set(selectable.path, selectable);
      });
    }

    return {
      select: action(() => {
        // Clear others if not additive?
        // For now, let's assume single select or we need an additive flag in the handle?
        // The handle.select() is usually called by a click handler which might have modifiers.
        // But here we are just defining the capability.
        // Let's keep it simple: select() replaces selection.
        this.observableState.selection.clear();
        this.observableState.selection.set(selectable.path, selectable);
      })
    };
  }

  @action
  public queueSelectPaths(paths: string[], additive: boolean = false): void {
    if (!additive) {
      this.observableState.selection.clear();
      this.observableState.queuedSelection.clear();
    }

    for (const path of paths) {
      // If we already have the selectable, select it directly
      if (this.observableState.selection.has(path)) {
        // It's already selected, do nothing (or update timestamp if we tracked that)
      } else {
        // Otherwise, queue it and wait for defineSelectable to claim it
        this.observableState.queuedSelection.add(path);
      }
    }
  }

  @action
  public setQueuedSelection(paths: string[]): void {
    this.observableState.queuedSelection.clear();
    for (const p of paths) {
      this.observableState.queuedSelection.add(p);
    }
  }

  @action
  public setInflightPortConnectionOperation(port: { nodeId: string; port: string; type: 'in' | 'out'; } | null): void {
    this.observableState.inflightPortConnectionOperation = port;
  }

  @action
  public loadSubgraph(id: string, graph: GraphState): void {
    this.observableState.loadedSubgraphs.set(id, graph);
  }

  @action
  public setShowDebugValues(enabled: boolean): void {
    this.observableState.localSettings.showDebugValues = enabled;
    this.saveSettings();
  }

  @action
  public setActiveTab(tab: string | null): void {
    this.observableState.localSettings.activeTab = tab;
    this.saveSettings();
  }

  @action
  public setEnableResolumeIO(enabled: boolean): void {
    this.observableState.localSettings.enableResolumeIO = enabled;
    this.saveSettings();
  }

  @action
  public setLastGroupSelection(selection: Set<string> | null): void {
    this.observableState.lastGroupSelection = selection;
  }

  @action
  public setViewport(x: number, y: number, w: number, h: number): void {
    this.observableState.viewport = { x, y, w, h };
  }

  @action
  public setDragPreview(preview: { x: number, y: number, w: number, h: number } | null): void {
    this.observableState.dragPreview = preview;
  }

  @action
  public setLoadedSubgraphs(subgraphs: Map<string, GraphState>) {
    this.observableState.loadedSubgraphs = subgraphs;
  }

  @action
  public setIsDraggingSelection(isDragging: boolean): void {
    this.observableState.isDraggingSelection = isDragging;
  }

  @action
  public setAltKeyPressed(pressed: boolean): void {
    if (this.observableState.altKeyPressed !== pressed) {
      this.observableState.altKeyPressed = pressed;
    }
  }

  public getViewportCenterGridCoordinates(): { x: number, y: number } {
    // Proposal:
    // Add `viewport` to `LocalState`.
    // Have `GraphGrid` update `LocalState.viewport` on scroll (throttled).
    // Then `getViewportCenter` uses that.

    // Let's start by adding the interface to LocalState, then implementing the sync.
    const { viewport } = this.observableState;
    if (!viewport || viewport.w === 0 || viewport.h === 0) return { x: 5, y: 5 }; // Fallback

    // Assuming 50px grid approximation or use GridMetrics?
    // Grid cells are variable width.
    // But we have rowOffsets!

    // Center X/Y in pixels
    const centerX = viewport.x + (viewport.w / 2);
    const centerY = viewport.y + (viewport.h / 2);

    // Find Row
    // Iterate rowOffsets to find Y
    let gridY = 0;
    for (const [row, offset] of this.observableState.gridMetrics.rowOffsets) {
      if (offset > centerY) {
        gridY = Math.max(0, row - 1);
        break;
      }
      gridY = row;
    }

    // Extrapolation for empty space below content
    // If the loop finished without breaking (meaning centerY > all offsets),
    // OR if we are at the last known row but centerY is way below it.
    const lastRowIndex = Math.max(0, ...this.observableState.gridMetrics.rowOffsets.keys());

    // Only attempt extrapolation if we are at or theoretically past the last known row
    // (Note: gridY set to 'row' in the loop tracks the current row being checked.
    // If we passed all, gridY is the last row index.)
    if (gridY >= lastRowIndex) {
      const lastRowTop = this.observableState.gridMetrics.rowOffsets.get(lastRowIndex) || 16;
      const lastRowHeight = this.observableState.gridMetrics.rows.get(lastRowIndex) || 80;
      const bottomOfLastRow = lastRowTop + lastRowHeight;

      if (centerY > bottomOfLastRow) {
        const diff = centerY - bottomOfLastRow;
        const stride = 80 + 16; // 96px (Default Height + Gap)
        // Calculate how many rows down we are
        // If we are just 1px below, we are in the next row (conceptually)
        const extraRows = Math.floor(diff / stride) + 1;
        gridY = lastRowIndex + extraRows;
      }
    }

    return { x: 5, y: gridY };
  }

  @action
  public copyToClipboard(): void {
    const state = this.appController.getState();
    const selection = this.observableState.selection;
    if (selection.size === 0) return;

    const selectedNodeIds: string[] = [];
    for (const [path] of selection) {
      // Assuming path is node ID.
      // Filter out non-node selections like wires for now?
      // Actually connectivity is implicitly handled by duplicateNodes logic usually,
      // but here we want to capture connectivity between selected nodes explicitly.
      if (state.graph.inner.nodes[path]) {
        selectedNodeIds.push(path);
      }
    }

    if (selectedNodeIds.length === 0) return;

    const nodes = selectedNodeIds.map(id => state.graph.inner.nodes[id]);
    const connections = Object.values(state.graph.inner.connections).filter((c: any) =>
      selectedNodeIds.includes(c.fromNodeId) && selectedNodeIds.includes(c.toNodeId)
    );

    this.observableState.clipboard = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      connections: JSON.parse(JSON.stringify(connections))
    };
  }

  public findFreeSpace(gridX: number, checkY: number): { x: number, y: number } {
    const nodes = this.appController.getState().graph.inner.nodes;
    let targetY = checkY;
    let attempts = 0;
    const maxAttempts = 50; // Increased search range

    while (attempts < maxAttempts) {
      // Check for collision with any existing node
      const occupied = Object.values(nodes).some((n: any) => n.x === gridX && n.y === targetY);
      if (!occupied) return { x: gridX, y: targetY };
      targetY++;
      attempts++;
    }
    // Fallback if full: checkY
    return { x: gridX, y: checkY };
  }


  public getGridCellFromPixels(x: number, y: number): { x: number, y: number } {
    const { rowOffsets, colOffsets, rows, columnWidths } = this.observableState.gridMetrics;

    // Find Row (Y)
    let gridY = 0;
    const maxRow = Math.max(...Array.from(rows.keys()), -1);
    for (let r = 0; r <= maxRow; r++) {
      const top = rowOffsets.get(r) ?? 0;
      const h = rows.get(r) ?? 80;
      const gap = h > 0 ? 16 : 0;
      if (y >= top && y < top + h + gap) {
        gridY = r;
        break;
      }
      if (r === maxRow && y >= top + h + gap) {
        // Below last row
        // Extrapolate?
        const diff = y - (top + h + gap);
        const stride = 80 + 16;
        gridY = maxRow + 1 + Math.floor(diff / stride);
      }
    }

    // Find Column (X)
    let gridX = 0;
    const maxCol = Math.max(...Array.from(columnWidths.keys()), -1);

    if (x < 96) {
      gridX = 0; // Snap to first column if too far left
      // Or return -1 if we support drag to input?
      // Primitives usually live in standard grid.
    } else {
      let found = false;
      for (let c = 0; c <= maxCol; c++) {
        const left = colOffsets.get(c) ?? 0;
        const w = columnWidths.get(c) ?? 80;
        const gap = w > 0 ? 16 : 0;
        if (x >= left && x < left + w + gap) {
          gridX = c;
          found = true;
          break;
        }
      }
      if (!found) {
        // To the right of last column
        const lastLeft = colOffsets.get(maxCol) ?? 96;
        const lastW = columnWidths.get(maxCol) ?? 80;
        const rightEdge = lastLeft + lastW + 16;
        if (x >= rightEdge) {
          // Extrapolate
          const diff = x - rightEdge;
          const stride = 80 + 16;
          gridX = maxCol + 1 + Math.floor(diff / stride);
        }
      }
    }

    return { x: gridX, y: gridY };
  }
}
