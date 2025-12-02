import './nodes';
import { html } from 'lit';
import { defaultNodeRepository } from '../../structor/repository';
import '../../views/graph-widget';
import { GraphWidgetConfig } from '../../views/graph-widget';

import { appController } from '../../builder/controllers';
import { toJS } from 'mobx';

const curveEase = defaultNodeRepository.getNodeType('curve.ease');

if (curveEase) {
  curveEase.renderBody = (node) => {
    const easingConfig = (node.config.values?.easing as any as GraphWidgetConfig | undefined) ?? {
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
      onSegmentChange: (segmentId, param, value) => {
        const innerEasingConfig = toJS(easingConfig);
        const nodeConfig = toJS(node.config);
        const newSegments = innerEasingConfig.segments.map((s: any) => {
          if (s.id === segmentId) {
            if (param === 'value') {
              return { ...s, curve: { ...s.curve, value: value } };
            }
          }
          return s;
        });
        appController.setNodeConfig(node.id, { values: { ...nodeConfig.values, easing: { ...innerEasingConfig, segments: newSegments } as any } });
      },
      onSegmentResize: (segmentIndex, newWeight) => {
        const innerEasingConfig = toJS(easingConfig);
        const nodeConfig = toJS(node.config);
        const newSegments = [...innerEasingConfig.segments];
        if (newSegments[segmentIndex]) {
          newSegments[segmentIndex] = { ...newSegments[segmentIndex], weight: newWeight };
          appController.setNodeConfig(node.id, { values: { ...nodeConfig.values, easing: { ...innerEasingConfig, segments: newSegments } as any } });
        }
      }
    };

    return html`
      <graph-widget style="pointer-events: auto;" .config=${widgetConfig}></graph-widget>
    `;
  };

  curveEase.getBodyHeight = () => 96;
}
