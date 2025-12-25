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
