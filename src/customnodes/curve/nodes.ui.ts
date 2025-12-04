import './nodes';
import { html } from 'lit';
import '../../views/graph-widget';
import { GraphWidgetConfig } from '../../views/graph-widget';

import { appController, runtimeManager } from '../../builder/controllers';
import { toJS } from 'mobx';

import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from '../../views/mobx-lit-element';
import { GridNode } from '../../builder/state';
import { GraphNodeRenderHandlers, InspectorChangeHandler, defaultNodeRepository } from '../../structor/repository';

@customElement('curve-inspector')
export class CurveInspector extends MobxLitElement {
  @property({ attribute: false })
  node!: GridNode;

  private longEdit: any = null;

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
      domain: easingConfig.domain as any,
      range: easingConfig.range as any,
      segments: easingConfig.segments as any,
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
