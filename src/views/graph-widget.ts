import { html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { action, computed, makeObservable, observable } from 'mobx';
import { PointerDragOp } from '../utils/pointer-drag-op';

export type CurveType = 'exponential' | 'linear' | 'step' | 'sin' | 'quad' | 'points';

export interface GraphSegment {
  id: string;
  weight: number;
  curve: {
    type: CurveType;
    value?: number; // For exponential (exponent), step (count)
    points?: { x: number, y: number }[]; // For points type (normalized 0-1)
  };
}

export interface GraphWidgetConfig {
  domain: [number, number];
  range: [number, number];
  segments: GraphSegment[];
  interactive?: boolean;
  onSegmentChange?: (segmentId: string, param: string, value: number) => void;
  onSegmentResize?: (segmentIndex: number, newWeight: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

@customElement('graph-widget')
export class GraphWidget extends MobxLitElement {
  @property({ attribute: false })
  config?: GraphWidgetConfig;

  static styles = css`
        :host {
            display: block;
            width: 100%;
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

      // Pre-calculate parameters based on type
      let exponent = 1;
      if (segment.curve.type === 'exponential') {
        exponent = Math.pow(10, -(segment.curve.value ?? 0));
      }

      const steps = segment.curve.type === 'step' ? (segment.curve.value ?? 2) : 1;

      // For 'points', we just iterate through the provided points
      if (segment.curve.type === 'points' && segment.curve.points) {
        segment.curve.points.forEach(p => {
          const t = p.x; // Normalized x within segment
          const yVal = minY + p.y * (maxY - minY); // Map normalized y to value range

          const svgX = startX + t * (endX - startX);
          const svgY = height - (normalize(yVal, minY, maxY) * height);
          points.push([svgX, svgY]);
        });
        return;
      }

      // For analytical curves
      for (let i = 0; i <= stepsPerSegment; i++) {
        const t = i / stepsPerSegment;
        // x within segment (0 to 1)

        let normY = 0;

        switch (segment.curve.type) {
          case 'exponential':
            normY = Math.pow(t, exponent);
            break;
          case 'linear':
            normY = t;
            break;
          case 'step':
            // Steps: 0 to 1
            // e.g. 2 steps: 0-0.5 -> 0, 0.5-1 -> 1? Or 0, 0.5, 1?
            // "Step" usually means discrete levels.
            // Let's implement floor(t * steps) / (steps - 1)
            if (steps <= 1) normY = 0;
            else normY = Math.floor(t * steps) / (steps - 1);
            // Fix last point to be 1
            if (t >= 0.999) normY = 1;
            break;
          case 'sin':
            // EaseInOutSine: -(cos(PI * x) - 1) / 2
            normY = -(Math.cos(Math.PI * t) - 1) / 2;
            break;
          case 'quad':
            // EaseInQuad: t * t
            normY = t * t;
            break;
          default:
            normY = t;
        }

        const yVal = minY + normY * (maxY - minY);
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

      if (this.config.onInteractionStart) this.config.onInteractionStart();

      new PointerDragOp(e, this, {
        move: (_e, delta) => {
          const newWidth = startSegmentWidth + delta[0];
          const pixelToWeightRatio = this.totalWeight / width;
          const newWeight = newWidth * pixelToWeightRatio;

          if (newWeight > 0 && this.config?.onSegmentResize) {
            this.config.onSegmentResize(resizeIndex, newWeight);
          }
        },
        complete: () => {
          if (this.config?.onInteractionEnd) this.config.onInteractionEnd();
        }
      });
      return;
    }

    // Parameter Change Mode
    if (this.config.onSegmentChange) {
      const targetSegment = layout.find(l => startX >= l.startX && startX <= l.endX);
      if (targetSegment && targetSegment.segment.curve.type === 'exponential') {
        if (this.config.onInteractionStart) this.config.onInteractionStart();

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
          },
          complete: () => {
            if (this.config?.onInteractionEnd) this.config.onInteractionEnd();
          }
        });
      }
    }
  }

  @observable
  hoveredSegmentIndex = -1;

  @observable
  hoveredSplitIndex = -1;

  @action
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

  @action
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

      // Only calculate handle for exponential curves
      let handleY = 0;
      let centerX = 0;
      let showHandle = false;

      if (segment.curve.type === 'exponential') {
        const tHandle = (1 - (segment.curve.value ?? 0)) / 2;
        handleY = tHandle * height;
        centerX = startX + (endX - startX) / 2;
        showHandle = true;
      }

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
                        ${this.config?.interactive && showHandle ? svg`
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
