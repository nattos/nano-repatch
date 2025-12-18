import { HTMLTemplateResult } from 'lit';
import { observable, makeObservable, action, runInAction, toJS } from 'mobx';
import { computeWireLayout, LayoutResult } from '../layout/wire-layout';
import { GraphState, Connection, GridNode } from './state';
import { settingsManager } from './settings-manager';
import { StructorType } from '../structor/structor';
import { defaultNodeRepository, PortHint } from '../structor/repository';
import { NODE_WIDTH_NORMAL, NODE_WIDTH_MINIMAL, NODE_WIDTH_COMPRESSED } from '../constants';
import { getNodeVisualState, NodeVisualState, calculatePortY, calculateNodeHeight } from '../utils/node-width-utils';

// Part 4: Local Controller (UI State)

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

  // Serialized settings.
  localSettings: LocalSettings;
}

// Serialized settings.
export interface LocalSettings {
  showDebugValues: boolean;
  activeTab: string | null;
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
}

export interface GridMetrics {
  cells: Map<string, CellMetric>; // Key "x,y"
  columns: Map<number, NodeVisualState>; // Column Index -> Widest State
  columnWidths: Map<number, number>; // Column Index -> Max Width in px
  rows: Map<number, number>; // Row Index -> Max Height in px
  rowOffsets: Map<number, number>; // Row Index -> Accum. Pixels from Top (for Node Top)
}

// ... existing code ...

export class LocalController {
  public observableState: LocalState;
  public settingsLoaded: Promise<void>;


  private layoutWorker: Worker;

  constructor() {
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
      gridMetrics: {
        cells: new Map(),
        columns: new Map(),
        columnWidths: new Map(),
        rows: new Map(),
        rowOffsets: new Map()
      },
      localSettings: {
        showDebugValues: false,
        activeTab: 'workspace',
      },
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

    // 2. Inputs Union Strategy (Repo + Inferred)
    // Start with a copy of Repo inputs
    let inputMap = new Map<string, PortHint>();
    inputs.forEach(p => inputMap.set(p.name, p));

    if (inferredType && inferredType.inputs && (inferredType.inputs as any).kind === 'record' && (inferredType.inputs as any).fields) {
      const fields = (inferredType.inputs as any).fields;
      Object.entries(fields).forEach(([name, type]) => {
        // If exists, update type? Or keep Repo type?
        // Inferred is usually more specific (e.g. 'float' vs 'any'), so update type.
        // But keep Description/Metadata from Repo.
        const existing = inputMap.get(name);
        inputMap.set(name, {
          name,
          type: type as StructorType,
          description: existing?.description || name,
          defaultValue: (type as any).defaultValue ?? existing?.defaultValue,
          ...existing // Spread repo props (like suppressLabel)
        });
      });
    }

    // Convert back to array
    inputs = Array.from(inputMap.values());

    // Sort: Repo Order first, then New Ports Alphabetical
    if (nodeType?.inputs) {
      inputs.sort((a, b) => {
        const idxA = nodeType.inputs!.findIndex(p => p.name === a.name);
        const idxB = nodeType.inputs!.findIndex(p => p.name === b.name);

        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1; // A in Repo, B New -> A first
        if (idxB !== -1) return 1;  // B in Repo, A New -> B first
        return a.name.localeCompare(b.name); // Both New -> Alphabetical
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


  // ... existing code ...

  @action
  public updateWireLayout(graph: GraphState): void {
    const { nodes, connections } = graph.inner;

    // 1. Synchronously update metrics so the App has correct sizes immediately
    this.updateGridMetrics(graph);

    // 2. Prepare payload for worker
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
      // Height: Header(1) + Ports.
      return { x: n.x, y: n.y, height: portCount + 1 };
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
        start: { x: fromNode.x, y: fromNode.y },
        end: { x: toNode.x, y: toNode.y },
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
      rowOffsets: new Map()
    };

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
      const state = getNodeVisualState(inputs, outputs, connectedPorts, hasCustomBody);

      let width = NODE_WIDTH_NORMAL;
      if (node.config.width) {
        width = node.config.width;
      } else {
        if (state === 'minimal') width = NODE_WIDTH_MINIMAL;
        else if (state === 'compressed') width = NODE_WIDTH_COMPRESSED;
        else width = NODE_WIDTH_NORMAL;
      }

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
        portOutputCount: outputs.length
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
      // Post-Process: Calculate Row Offsets
      let currentY = 16;
      const maxRow = Math.max(...Array.from(metrics.rows.keys()), -1);
      for (let r = 0; r <= maxRow; r++) {
        metrics.rowOffsets.set(r, currentY);
        // Default to 80px for empty/collapsed rows so the Grid Layout remains stable
        const h = metrics.rows.get(r) || 80;
        currentY += h + 16;
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
  public setLastGroupSelection(selection: Set<string> | null): void {
    this.observableState.lastGroupSelection = selection;
  }
}
