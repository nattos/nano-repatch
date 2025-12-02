import './nodes';
import { html } from 'lit';
import '../../views/graph-widget';
import { GraphWidgetConfig } from '../../views/graph-widget';

import { appController } from '../../builder/controllers';
import { toJS } from 'mobx';

import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from '../../views/mobx-lit-element';
import { GridNode } from '../../builder/state';
import { GraphNodeRenderHandlers, InspectorChangeHandler } from '../../structor/repository';

@customElement('curve-inspector')
export class CurveInspector extends MobxLitElement {
  @property({ attribute: false })
  node!: GridNode;

  private longEdit: any = null;

  render() {
    if (!this.node) return html``;

    const easingConfig = (this.node.config.values?.easing as any as GraphWidgetConfig | undefined) ?? {
      domain: [0, 1],
      range: [0, 1],
      segments: [{
        id: 's1',
        weight: 1,
        curve: { type: 'exponential', value: 0 }
      }]
    };

    const widgetConfig: GraphWidgetConfig = {
      domain: easingConfig.domain,
      range: easingConfig.range,
      segments: easingConfig.segments,
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
          const newSegments = innerEasingConfig.segments.map((s: any) => {
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
          const newSegments = [...innerEasingConfig.segments];
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
