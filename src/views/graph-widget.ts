import { html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { computed, makeObservable, observable } from 'mobx';
import { PointerDragOp } from '../utils/pointer-drag-op';

export interface GraphSegment {
  id: string;
  weight: number;
  curve: {
    type: 'exponential';
    value: number; // -1.0 to 1.0
  };
}

export interface GraphWidgetConfig {
  domain: [number, number];
  range: [number, number];
  segments: GraphSegment[];
  interactive?: boolean;
  onSegmentChange?: (segmentId: string, param: string, value: number) => void;
  onSegmentResize?: (segmentIndex: number, newWeight: number) => void;
}

@customElement('graph-widget')
export class GraphWidget extends MobxLitElement {
  @property({ attribute: false })
  config?: GraphWidgetConfig;

  static styles = css`
        :host {
            display: block;
            width: 220px;
            height: 96px;
            background: var(--node-bg, #333);
            border: 1px solid var(--node-border, #444);
            border-radius: 4px;
            overflow: hidden;
            position: relative;
            user-select: none;
            --grid-color: rgba(255, 255, 255, 0.05);
            --grid-size: 24px;
        }
        svg {
            width: 100%;
            height: 100%;
            display: block;
        }
        path.curve {
            fill: url(#curveGradient);
            stroke: var(--accent-color, #00aaff);
            stroke-width: 2;
            vector-effect: non-scaling-stroke;
            pointer-events: none;
        }
        .grid-pattern {
            stroke: var(--grid-color);
            stroke-width: 1;
        }
        .axis-line {
            stroke: var(--border-color, #555);
            stroke-width: 1;
            vector-effect: non-scaling-stroke;
        }
        .handle-line {
            stroke: var(--accent-color, #00aaff);
            stroke-width: 1;
            stroke-dasharray: 4 4;
            vector-effect: non-scaling-stroke;
            opacity: 0.7;
        }
        .handle-circle {
            fill: var(--accent-color, #00aaff);
            stroke: var(--node-bg, #333);
            stroke-width: 2;
        }
        .split-handle {
            stroke: var(--text-muted, #aaa);
            stroke-width: 1;
            stroke-dasharray: 2 2;
            vector-effect: non-scaling-stroke;
            opacity: 0.5;
            cursor: col-resize;
        }
        .split-handle-target {
            fill: transparent;
            cursor: col-resize;
        }
        .split-handle-target:hover {
            fill: rgba(255, 255, 255, 0.1);
        }
    `;

  constructor() {
    super();
    makeObservable(this);
  }

  @computed
  get totalWeight() {
    return this.config?.segments.reduce((sum, s) => sum + s.weight, 0) || 1;
  }

  @computed
  get segmentLayout() {
    if (!this.config) return [];
    const width = 220;
    let currentX = 0;
    const totalWeight = this.totalWeight;

    return this.config.segments.map((segment, index) => {
      const segmentWidth = (segment.weight / totalWeight) * width;
      const layout = {
        segment,
        index,
        startX: currentX,
        endX: currentX + segmentWidth,
        width: segmentWidth
      };
      currentX += segmentWidth;
      return layout;
    });
  }

  @computed
  get pathData() {
    if (!this.config) return '';

    const { domain, range } = this.config;
    const [minY, maxY] = range;
    const height = 96;
    const normalize = (val: number, min: number, max: number) => (val - min) / (max - min);

    const points: [number, number][] = [];
    const stepsPerSegment = 20;

    this.segmentLayout.forEach(layout => {
      const { segment, startX, endX } = layout;

      // Map value (-1 to 1) to exponent
      // 1 -> 0.1 (10^-1)
      // 0 -> 1.0 (10^0)
      // -1 -> 10.0 (10^1)
      // exponent = 10^(-value)
      const exponent = Math.pow(10, -segment.curve.value);

      for (let i = 0; i <= stepsPerSegment; i++) {
        const t = i / stepsPerSegment;
        // x within segment (0 to 1)

        let yVal = 0;
        if (segment.curve.type === 'exponential') {
          const normY = Math.pow(t, exponent);
          yVal = minY + normY * (maxY - minY);
        }

        const svgX = startX + t * (endX - startX);
        const svgY = height - (normalize(yVal, minY, maxY) * height);
        points.push([svgX, svgY]);
      }
    });

    return `M ${points.map(p => p.join(',')).join(' L ')}`;
  }

  private handlePointerDown(e: PointerEvent) {
    if (!this.config?.interactive) return;

    const rect = this.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const width = rect.width;
    const height = rect.height;
    const layout = this.segmentLayout;

    // Check for resize (near split boundaries)
    const resizeThreshold = 10;
    let resizeIndex = -1;

    for (let i = 0; i < layout.length - 1; i++) {
      const boundaryX = layout[i].endX;
      if (Math.abs(startX - boundaryX) < resizeThreshold) {
        resizeIndex = i;
        break;
      }
    }

    if (resizeIndex !== -1 && this.config.onSegmentResize) {
      // Resize Mode
      const startSegmentWidth = layout[resizeIndex].width;

      new PointerDragOp(e, this, {
        move: (_e, delta) => {
          // delta[0] is change in pixels
          // newWidth = startSegmentWidth + delta[0]
          // newWeight = (newWidth / startSegmentWidth) * startWeight
          // This is an approximation assuming linear relation locally
          // Better: newWeight = ((startSegmentWidth + delta[0]) / width) * totalWeight
          // But totalWeight changes if we change one weight?
          // Let's stick to the previous logic:
          // newWidth = currentX - startX_of_segment
          // But here we have delta.

          const newWidth = startSegmentWidth + delta[0];
          const pixelToWeightRatio = this.totalWeight / width;
          const newWeight = newWidth * pixelToWeightRatio;

          if (newWeight > 0 && this.config?.onSegmentResize) {
            this.config.onSegmentResize(resizeIndex, newWeight);
          }
        }
      });
      return;
    }

    // Parameter Change Mode
    if (this.config.onSegmentChange) {
      const targetSegment = layout.find(l => startX >= l.startX && startX <= l.endX);
      if (targetSegment) {
        new PointerDragOp(e, this, {
          move: (e, _delta) => {
            // For parameter, we want absolute position
            const rect = this.getBoundingClientRect();
            const y = e.clientY - rect.top;

            // Clamp y
            const clampedY = Math.max(0, Math.min(height, y));

            // Map Y to value [-1, 1]
            // y=0 (top) -> 1.0
            // y=height (bottom) -> -1.0
            // t = y / height (0 to 1)
            // value = 1 - 2*t

            const t = clampedY / height;
            const newValue = 1 - 2 * t;

            if (this.config?.onSegmentChange) {
              this.config.onSegmentChange(targetSegment.segment.id, 'value', newValue);
            }
          }
        });
      }
    }
  }

  @observable
  hoveredSegmentIndex = -1;

  @observable
  hoveredSplitIndex = -1;

  private handlePointerMove(e: PointerEvent) {
    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const layout = this.segmentLayout;

    // Reset hover
    this.hoveredSegmentIndex = -1;
    this.hoveredSplitIndex = -1;

    // Check for resize (near split boundaries)
    const resizeThreshold = 10;
    for (let i = 0; i < layout.length - 1; i++) {
      const boundaryX = layout[i].endX;
      if (Math.abs(x - boundaryX) < resizeThreshold) {
        this.hoveredSplitIndex = i;
        return;
      }
    }

    // Check for segment hover
    const segmentIndex = layout.findIndex(l => x >= l.startX && x <= l.endX);
    if (segmentIndex !== -1) {
      this.hoveredSegmentIndex = segmentIndex;
    }
  }

  private handlePointerLeave() {
    this.hoveredSegmentIndex = -1;
    this.hoveredSplitIndex = -1;
  }

  render() {
    if (!this.config) return html``;

    const height = 96;
    const layout = this.segmentLayout;
    const resizeThreshold = 10;

    return html`
            <svg viewBox="0 0 220 96" preserveAspectRatio="none"
                @pointerdown=${(e: PointerEvent) => this.handlePointerDown(e)}
                @pointermove=${(e: PointerEvent) => this.handlePointerMove(e)}
                @pointerleave=${() => this.handlePointerLeave()}
            >
                <defs>
                    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                        <path d="M 24 0 L 0 0 0 24" fill="none" class="grid-pattern" />
                    </pattern>
                    <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="var(--accent-color)" stop-opacity="0.2" />
                        <stop offset="100%" stop-color="var(--accent-color)" stop-opacity="0.0" />
                    </linearGradient>
                </defs>

                <rect width="100%" height="100%" fill="url(#grid)" />

                <!-- Axis Lines -->
                <line class="axis-line" x1="0" y1="${height / 2}" x2="220" y2="${height / 2}" />

                <!-- Segments -->
                ${layout.map(l => {
      const { segment, startX, endX } = l;
      const isHovered = l.index === this.hoveredSegmentIndex;
      const isSplitHovered = l.index === this.hoveredSplitIndex;

      // value = 1 - 2*t
      // 2*t = 1 - value
      // t = (1 - value) / 2
      // y = t * height

      const tHandle = (1 - segment.curve.value) / 2;
      const handleY = tHandle * height;
      const centerX = startX + (endX - startX) / 2;

      return svg`
                        <!-- Hover Highlight -->
                        ${isHovered && this.config?.interactive ? svg`
                            <rect x="${startX}" y="0" width="${endX - startX}" height="${height}"
                                fill="var(--accent-color)" fill-opacity="0.05" pointer-events="none" />
                        ` : ''}

                        <!-- Segment Separator (if not last) -->
                        ${l.index < layout.length - 1 ? svg`
                            <line class="split-handle" x1="${endX}" y1="0" x2="${endX}" y2="${height}"
                                style="${isSplitHovered ? 'opacity: 1; stroke-width: 2; stroke: var(--accent-color);' : ''}" />
                            <!-- Visual target matches resizeThreshold * 2 -->
                            <rect class="split-handle-target" x="${endX - resizeThreshold}" y="0" width="${resizeThreshold * 2}" height="${height}" />
                        ` : ''}

                        <!-- Parameter Handle -->
                        ${this.config?.interactive ? svg`
                            <line class="handle-line" x1="${startX}" y1="${handleY}" x2="${endX}" y2="${handleY}"
                                style="${isHovered ? 'opacity: 1; stroke-width: 2;' : ''}" />
                            <circle class="handle-circle" cx="${centerX}" cy="${handleY}" r="${isHovered ? 6 : 4}" />
                        ` : ''}
                    `;
    })}

                <path class="curve" d="${this.pathData} L 220 ${height} L 0 ${height} Z" />
            </svg>
        `;
  }
}
