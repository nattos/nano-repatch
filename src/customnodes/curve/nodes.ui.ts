import './nodes';
import { html } from 'lit';
import '../../views/graph-widget';
import { GraphWidgetConfig } from '../../views/graph-widget';

import { appController, runtimeManager } from '../../builder/controllers';
import { toJS } from 'mobx';

import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from '../../views/mobx-lit-element';
import { GridNode, LongEdit, AppController } from '../../builder/state';
import { GraphNodeRenderHandlers, InspectorChangeHandler, defaultNodeRepository } from '../../structor/repository';

@customElement('curve-inspector')
export class CurveInspector extends MobxLitElement {
  @property({ attribute: false })
  node!: GridNode;

  private longEdit: LongEdit | null = null;

  render() {
    if (!this.node) return html``;

    const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);
    let defaultEasing = {
      domain: [0, 1],
      range: [0, 1],
      segments: [{
        id: 's1',
        weight: 1,
        curve: { type: 'exponential', value: 0 }
      }]
    };

    if (nodeType && nodeType.inputs) {
      const easingInput = nodeType.inputs.find(i => i.name === 'easing');
      if (easingInput && easingInput.defaultValue) {
        defaultEasing = easingInput.defaultValue;
      }
    }

    const easingConfig = (this.node.config.values?.easing as any as GraphWidgetConfig | undefined) ?? defaultEasing;

    const widgetConfig: GraphWidgetConfig = {
      domain: (easingConfig.domain || [0, 1]) as [number, number],
      range: (easingConfig.range || [0, 1]) as [number, number],
      segments: (easingConfig.segments || []).map((s: any) => ({
        ...s,
        curve: {
          ...s.curve,
          type: s.curve.type as any
        }
      })),
      interactive: true,
      onInteractionStart: () => {
        this.longEdit = appController.beginLongEdit({
          apply: () => { },
          cancel: () => { this.longEdit = null; }
        });
      },
      onInteractionEnd: () => {
        if (this.longEdit) {
          this.longEdit.accept();
          this.longEdit = null;
        }
      },
      onSegmentChange: (segmentId, param, value) => {
        const update = (c: any) => {
          const innerEasingConfig = toJS(easingConfig);
          const nodeConfig = toJS(this.node.config);
          const newSegments = (innerEasingConfig.segments || []).map((s: any) => {
            if (s.id === segmentId) {
              if (param === 'value') {
                return { ...s, curve: { ...s.curve, value: value } };
              }
            }
            return s;
          });
          c.setNodeConfig(this.node.id, { values: { ...nodeConfig.values, easing: { ...innerEasingConfig, segments: newSegments } as any } });
        };

        if (this.longEdit) {
          this.longEdit.applyAgain(update);
        } else {
          update(appController);
        }
      },
      onSegmentResize: (segmentIndex, newWeight) => {
        const update = (c: any) => {
          const innerEasingConfig = toJS(easingConfig);
          const nodeConfig = toJS(this.node.config);
          const newSegments = [...(innerEasingConfig.segments || [])];
          if (newSegments[segmentIndex]) {
            newSegments[segmentIndex] = { ...newSegments[segmentIndex], weight: newWeight };
            c.setNodeConfig(this.node.id, { values: { ...nodeConfig.values, easing: { ...innerEasingConfig, segments: newSegments } as any } });
          }
        };

        if (this.longEdit) {
          this.longEdit.applyAgain(update);
        } else {
          update(appController);
        }
      }
    };

    // Get input value for cursor
    const inputs = runtimeManager.inputs.get(this.node.id);
    let cursorValue: number | undefined = undefined;
    if (inputs) {
      if (inputs.fields && inputs.fields['value'] !== undefined) {
        cursorValue = inputs.fields['value'];
      } else if (inputs.untagged && inputs.untagged.length > 0) {
        cursorValue = inputs.untagged[0];
      }
    }

    // Normalize cursor if domain is not 0-1
    if (cursorValue !== undefined) {
      const [minIn, maxIn] = widgetConfig.domain || [0, 1];
      cursorValue = (cursorValue - minIn) / (maxIn - minIn);
      cursorValue = Math.max(0, Math.min(1, cursorValue));
    }

    widgetConfig.cursor = cursorValue;

    return html`
      <graph-widget style="pointer-events: auto;" .config=${widgetConfig}></graph-widget>
    `;
  }
}

export const CurveBodyRenderer = (node: GridNode, handlers: GraphNodeRenderHandlers) => {
  return html`<curve-inspector .node=${node}></curve-inspector>`;
};

export const CurveInspectorRenderer = (node: GridNode, onchange: InspectorChangeHandler) => {
  // We can reuse the same component or a different one for inspector
  return html`<div>Curve Inspector Placeholder</div>`;
};

export const CurveBodyHeight = (node: GridNode) => 100;

@customElement('curve-env-inspector')
export class CurveEnvInspector extends MobxLitElement {
  @property({ attribute: false })
  node!: GridNode;

  private longEdit: LongEdit | null = null;

  render() {
    if (!this.node) return html``;

    const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);
    let defaultConfig: any = {
      domain: [0, 1] as [number, number],
      range: [0, 1] as [number, number],
      envelopeNodes: [
        { id: 'n1', x: 0, y: 0 },
        { id: 'n2', x: 1, y: 1 }
      ],
      segments: [
        { id: 's1', weight: 1, curve: { type: 'linear' as const } }
      ]
    };

    if (nodeType && nodeType.inputs) {
      const configInput = nodeType.inputs.find(i => i.name === 'config');
      if (configInput && configInput.defaultValue) {
        defaultConfig = configInput.defaultValue;
      }
    }

    // curve.env stores config in 'curveData' field (or legacy 'values.config')
    const envConfig = ((this.node.config as any).curveData as GraphWidgetConfig | undefined) ??
      (this.node.config.values?.config as any as GraphWidgetConfig | undefined) ??
      defaultConfig;

    const widgetConfig: GraphWidgetConfig = {
      // ... (keep existing lines)
      ...envConfig,
      domain: (envConfig.domain || [0, 1]) as [number, number],
      range: (envConfig.range || [0, 1]) as [number, number],
      interactive: true,
      onInteractionStart: () => {
        this.longEdit = appController.beginLongEdit({
          apply: () => { },
          cancel: () => { this.longEdit = null; }
        });
      },
      onInteractionEnd: () => {
        if (this.longEdit) {
          this.longEdit.accept();
          this.longEdit = null;
        }
      },
      onEnvelopeChange: (newNodes: { id: string; x: number; y: number }[], newSegments: any[]) => {
        const update = (c: AppController) => {
          const innerConfig = toJS(envConfig);
          // Removed: const nodeConfig = toJS(this.node.config);
          // We don't need nodeConfig.values anymore since we are writing to root
          const newConfig: GraphWidgetConfig = {
            ...innerConfig,
            domain: (innerConfig.domain || [0, 1]) as [number, number],
            range: (innerConfig.range || [0, 1]) as [number, number],
            envelopeNodes: newNodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
            segments: newSegments.map((s) => ({
              id: s.id,
              weight: s.weight,
              curve: {
                type: (s.curve?.type || 'linear') as any,
                value: s.curve?.value,
                points: s.curve?.points
              }
            }))
          };
          delete newConfig.onInteractionStart;
          delete newConfig.onInteractionEnd;
          delete newConfig.onEnvelopeChange;
          delete newConfig.onSegmentChange;
          delete newConfig.onSegmentResize;

          // Use 'curveData' to trigger Config Update in AppController (bypassing 'inputUpdate' optimization)
          c.setNodeConfig(this.node.id, { curveData: newConfig });
        };

        if (this.longEdit) {
          this.longEdit.applyAgain(update);
        } else {
          // CRITICAL FIX: Ensure update is actually called!
          update(appController);
        }
      }
    };

    // Get input value for cursor
    const inputs = runtimeManager.inputs.get(this.node.id);
    let cursorValue: number | undefined = undefined;
    if (inputs) {
      if (inputs.fields && inputs.fields['value'] !== undefined) {
        cursorValue = inputs.fields['value'];
      } else if (inputs.untagged && inputs.untagged.length > 0) {
        cursorValue = inputs.untagged[0];
      }
    }

    // Normalize cursor if domain is not 0-1
    // Actually curve.env input is raw value, but graph widget expects normalized cursor?
    // Wait, GraphWidget logic for cursor usually expects 0-1 if it draws a line across the box.
    // curve.env input 'value' is expected to be within domain (or outside).
    // If we want to show cursor position relative to the graph view:
    // The graph view shows 'domain' on X axis.
    if (cursorValue !== undefined) {
      const [minIn, maxIn] = widgetConfig.domain || [0, 1];
      // Normalize to 0-1 of the view
      cursorValue = (cursorValue - minIn) / (maxIn - minIn);
      // cursorValue = Math.max(0, Math.min(1, cursorValue)); // Allow cursor outside?
    }

    widgetConfig.cursor = cursorValue;

    return html`
      <graph-widget style="pointer-events: auto;" .config=${widgetConfig}></graph-widget>
    `;
  }
}

export const CurveEnvBodyRenderer = (node: GridNode, handlers: GraphNodeRenderHandlers) => {
  return html`<curve-env-inspector .node=${node}></curve-env-inspector>`;
};

export const CurveEnvBodyHeight = (node: GridNode) => 100; // Taller for envelope editor?

@customElement('curve-crop-inspector')
export class CurveCropInspector extends MobxLitElement {
  @property({ attribute: false })
  node!: GridNode;

  render() {
    if (!this.node) return html``;

    // "Hero Node" Pattern: Read dynamic UI state from RuntimeManager
    // This gives us the real-time 'start' and 'end' values calculated by the worker
    const uiState = runtimeManager.uiStates.get(this.node.id);

    // Fallback to inputs (unconnected values) if UI state is missing (e.g. graph not running)
    const inputs = runtimeManager.inputs.get(this.node.id);
    // Helper to get input value or default
    const getVal = (key: string, def: number) => {
      if (uiState && typeof uiState[key] === 'number') return uiState[key];
      if (inputs && inputs.fields && typeof inputs.fields[key] === 'number') return inputs.fields[key];
      // Note: We don't have easy access to defaults here without nodeType check,
      // but defaults are 0 and 1.
      return def;
    };

    const start = getVal('start', 0);
    let end = getVal('end', 1);
    if (end < start) end = start;

    // Visualization:
    // We want to show the full 0-1 range, but "highlight" the cropped region [start, end].
    // Or do we show the cropped region as the "active" part of the curve?
    // If we map [start, end] -> [0, 1], then outside this range is clamped.
    // So the curve is flat 0 at left, linear ramp from start to end, flat 1 at right.

    // Nodes: (0,0), (start,0), (end,1), (1,1)

    const envelopeNodes = [
      { id: 'n0', x: 0, y: 0 },
      { id: 'n1', x: start, y: 0 },
      { id: 'n2', x: end, y: 1 },
      { id: 'n3', x: 1, y: 1 }
    ];

    // Filter duplicates if parameters overlap
    // GraphWidget might struggle with coincident nodes, but let's try.
    // Actually, simple way: Just 2 points (start,0) and (end,1).
    // The graph widget automatically extrapolates flat lines outside the defined segments range
    // IF the domain matches the nodes?
    // No, standard curve usually clamps at endpoints.
    // If we define nodes at start and end, and the domain is 0-1.

    const widgetConfig: GraphWidgetConfig = {
      domain: [0, 1],
      range: [0, 1],
      interactive: false,
      envelopeNodes: envelopeNodes,
      segments: [
        // Flat 0 region
        { id: 's0', weight: 1, curve: { type: 'linear', value: 0 } },
        // Ramp region
        { id: 's1', weight: 1, curve: { type: 'linear', value: 0 } },
        // Flat 1 region
        { id: 's2', weight: 1, curve: { type: 'linear', value: 0 } }
      ]
    };

    // Calculate cursor position
    let cursorValue: number | undefined = undefined;
    if (inputs) {
      // 'value' input
      if (inputs.fields && inputs.fields['value'] !== undefined) {
        cursorValue = inputs.fields['value'];
      } else if (inputs.untagged && inputs.untagged.length > 0) {
        cursorValue = inputs.untagged[0];
      }
    }

    // Normalize cursor
    if (cursorValue !== undefined) {
      cursorValue = Math.max(0, Math.min(1, cursorValue));
    }
    widgetConfig.cursor = cursorValue;

    return html`
      <graph-widget style="pointer-events: none; height: 50px; display: block;" .config=${widgetConfig}></graph-widget>
    `;
  }
}

export const CurveCropBodyRenderer = (node: GridNode, handlers: GraphNodeRenderHandlers) => {
  return html`<curve-crop-inspector .node=${node}></curve-crop-inspector>`;
};

export const CurveCropBodyHeight = (node: GridNode) => 50;

