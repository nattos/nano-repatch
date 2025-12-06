import { HTMLTemplateResult } from 'lit';
import { observable, makeObservable, action, runInAction, toJS } from 'mobx';
import { LayoutResult, WireDef, computeWireLayout } from '../layout/wire-layout';
import { GraphState } from './state';
import { settingsManager } from './settings-manager';

// Part 4: Local Controller (UI State)

export interface LocalState {
  selection: Map<string, Selectable>;
  queuedSelection: Set<string>;
  lastGroupSelection: Set<string> | null;
  inflightPortConnectionOperation: { nodeId: string; port: string; type: 'in' | 'out'; } | null;
  loadedSubgraphs: Map<string, GraphState>;
  wireLayout: LayoutResult;

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

export class LocalController {
  public observableState: LocalState;

  public settingsLoaded: Promise<void>;

  constructor() {
    this.observableState = observable({
      selection: new Map<string, Selectable>(),
      queuedSelection: new Set<string>(),
      lastGroupSelection: null,
      inflightPortConnectionOperation: null,
      loadedSubgraphs: new Map<string, GraphState>(),
      wireLayout: { wires: {} },
      localSettings: {
        showDebugValues: false,
        activeTab: 'workspace',
      },
    });
    makeObservable(this);

    this.settingsLoaded = this.loadSettings();
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
    const wires: WireDef[] = [];
    const nodes = graph.inner.nodes;

    for (const conn of Object.values(graph.inner.connections)) {
      const fromNode = nodes[conn.fromNodeId];
      const toNode = nodes[conn.toNodeId];

      if (fromNode && toNode) {
        // Simple port position estimation (center of node for now, or we can refine later)
        // Actually, we should use the grid coordinates.
        // Input/Output nodes have fixed positions in the grid logic (column 0 or last).
        // But for routing, we just need start/end points.
        // We need to know the actual grid coordinates.
        // For pinned nodes (input/output), we need to handle them carefully.
        // But the layout engine works on integer grid points.
        // Let's assume standard nodes are at x,y.
        // TODO: Refine start/end points based on ports?
        // For now, let's just route from node center to node center (or close to it).
        // Actually, the wire layout engine expects integer grid points.
        // Nodes occupy x,y.
        // Let's route from (fromNode.x + 1, fromNode.y) to (toNode.x, toNode.y).
        // This assumes left-to-right flow.
        let startX = fromNode.x;
        let startY = fromNode.y;
        let endX = toNode.x;
        let endY = toNode.y;

        // Handle pinned nodes
        if (fromNode.config.typeId === 'io.input') {
          startX = 0;
        } else if (fromNode.config.typeId === 'io.output') {
          startX = 21; // Pinned to right
        }

        if (toNode.config.typeId === 'io.input') {
          endX = 0;
        } else if (toNode.config.typeId === 'io.output') {
          endX = 21; // Pinned to right
        }

        wires.push({
          id: conn.id,
          start: { x: startX, y: startY }, // Output is on the right
          end: { x: endX, y: endY }, // Input is on the left
          fromNodeId: conn.fromNodeId,
          fromPort: conn.fromPort.toString(),
          toNodeId: conn.toNodeId,
          toPort: conn.toPort.toString(),
        });
      }
    }

    const obstacles = Object.values(nodes).map(n => ({ x: n.x, y: n.y }));

    // For now, we don't track granular changes, so we don't pass changedWireIds.
    // But we pass previousResult to allow for potential future optimizations or stability.
    const result = computeWireLayout(wires, {
      obstacles,
      previousResult: this.observableState.wireLayout
    });
    this.observableState.wireLayout = result;
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
