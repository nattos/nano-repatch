import { html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { action, computed, makeObservable, observable } from 'mobx';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { widgetStyles } from '../styles';

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
  mode?: 'curve' | 'scope';
  // Curve Mode
  domain?: [number, number];
  range?: [number, number];
  segments?: GraphSegment[];
  interactive?: boolean;
  onSegmentChange?: (segmentId: string, param: string, value: number) => void;
  onSegmentResize?: (segmentIndex: number, newWeight: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  cursor?: number; // Normalized 0-1

  // Scope Mode
  data?: number[]; // History
  historySize?: number;
  autoRange?: boolean;
  showGrid?: boolean;
}

@customElement('graph-widget')
export class GraphWidget extends MobxLitElement {
  @property({ attribute: false })
  config?: GraphWidgetConfig;

  @property({ type: Number })
  value?: number;

  @property({ type: Number })
  tick = 0;

  // Scope State
  private history: number[] = [];
  private smoothedRange = 1.0;
  private smoothedAnchor = 0.0;
  private isSigned = false;

  static styles = [
    widgetStyles,
    css`
      :host {
        height: 96px;
        --grid-color: rgba(255, 255, 255, 0.05);
        --grid-size: 24px;
      }
      path.curve {
        fill: none;
        stroke: var(--accent-color, #ff4500);
        stroke-width: 2;
        pointer-events: none;
      }
      .parameter-control {
        cursor: ns-resize;
      }
      .parameter-bg {
        fill: var(--accent-color, #ff4500);
        opacity: 0.05;
        transition: opacity 0.2s;
      }
      .parameter-control:hover .parameter-bg {
        opacity: 0.15;
      }
      .parameter-line {
        stroke: var(--accent-color, #ff4500);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
        opacity: 0.6;
        transition: all 0.2s;
      }
      .parameter-control:hover .parameter-line {
        opacity: 1;
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
    `
  ];

  constructor() {
    super();
    makeObservable(this);
  }

  updated(changedProperties: Map<string, any>) {
    if ((changedProperties.has('value') || changedProperties.has('tick')) && this.value !== undefined) {
      this.history.push(this.value);
      const maxSize = this.config?.historySize || 100;
      if (this.history.length > maxSize) this.history.shift();

      if (this.config?.mode === 'scope' && this.config.autoRange) {
        this.updateAdaptiveRange();
      }
      // Request update is automatic for property change, but we modified history which is private
      this.requestUpdate();
    }
  }

  private updateAdaptiveRange() {
    if (this.history.length === 0) return;

    const history = this.history;
    let minV = history[0];
    let maxV = history[0];
    let hasNegative = false;

    for (const v of history) {
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      if (v < 0) hasNegative = true;
    }

    // Latch signed mode
    if (hasNegative) this.isSigned = true;

    // Calculate required view
    const padding = 1.2;
    let targetRange = 1.0;
    let targetAnchor = 0.0;

    if (this.isSigned) {
      const signalCenter = (minV + maxV) / 2;
      const signalSpan = maxV - minV;
      const requiredSpan = Math.max(signalSpan * padding, 0.001);
      const quantizedRange = Math.pow(2, Math.ceil(Math.log2(requiredSpan)));
      const anchorStep = quantizedRange;
      const quantizedAnchor = Math.round(signalCenter / anchorStep) * anchorStep;

      targetRange = quantizedRange;
      targetAnchor = quantizedAnchor;

      const viewMin = targetAnchor - targetRange / 2;
      const viewMax = targetAnchor + targetRange / 2;

      if (minV < viewMin || maxV > viewMax) {
         targetRange *= 2;
      }
    } else {
      const span = Math.max(maxV - minV, 0.001);
      let qRange = Math.pow(2, Math.ceil(Math.log2(span * padding)));
      let qAnchor = Math.floor(minV / qRange) * qRange;

      if (qAnchor + qRange < maxV) {
        qRange *= 2;
        qAnchor = Math.floor(minV / qRange) * qRange;
      }

      targetRange = qRange;
      targetAnchor = qAnchor;
    }

    // Range Smoothing
    if (targetRange > this.smoothedRange) {
      this.smoothedRange = targetRange;
    } else {
      this.smoothedRange = this.smoothedRange * 0.95 + targetRange * 0.05;
      if (Math.abs(this.smoothedRange - targetRange) < 0.01) this.smoothedRange = targetRange;
    }

    // Anchor Smoothing
    const currentDisplayAnchor = this.getDisplayAnchor();
    const currentDisplayRange = this.getDisplayRange();

    let fits = false;
    if (this.isSigned) {
       const safeZone = 0.9;
       const safeMin = currentDisplayAnchor - (currentDisplayRange * safeZone) / 2;
       const safeMax = currentDisplayAnchor + (currentDisplayRange * safeZone) / 2;
       if (minV >= safeMin && maxV <= safeMax) fits = true;
    } else {
       const safeMin = currentDisplayAnchor;
       const safeMax = currentDisplayAnchor + currentDisplayRange * 0.9;
       if (minV >= safeMin && maxV <= safeMax) fits = true;
    }

    if (!fits) {
       this.smoothedAnchor = this.smoothedAnchor * 0.8 + targetAnchor * 0.2;
       if (Math.abs(this.smoothedAnchor - targetAnchor) < 0.01) this.smoothedAnchor = targetAnchor;
    } else {
       this.smoothedAnchor = this.smoothedAnchor * 0.99 + targetAnchor * 0.01;
    }
  }

  private getDisplayRange() {
     return Math.pow(2, Math.ceil(Math.log2(this.smoothedRange)));
  }

  private getDisplayAnchor() {
     const r = this.getDisplayRange();
     return Math.round(this.smoothedAnchor / r) * r;
  }

  @computed
  get totalWeight() {
    return this.config?.segments?.reduce((sum, s) => sum + s.weight, 0) || 1;
  }

  @computed
  get segmentLayout() {
    if (!this.config || !this.config.segments) return [];
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

    if (this.config.mode === 'scope') {
        const history = this.history;
        const width = 220;
        const height = 96;
        const historySize = this.config.historySize || 100;

        const range = this.config.autoRange ? this.getDisplayRange() : ((this.config.range?.[1] ?? 1) - (this.config.range?.[0] ?? 0));
        const anchor = this.config.autoRange ? this.getDisplayAnchor() : (this.config.range?.[0] ?? 0);

        let renderMin: number, renderMax: number;
        if (this.config.autoRange) {
            if (this.isSigned) {
                renderMin = anchor - range / 2;
                renderMax = anchor + range / 2;
            } else {
                renderMin = anchor;
                renderMax = anchor + range;
            }
        } else {
            renderMin = this.config.range?.[0] ?? 0;
            renderMax = this.config.range?.[1] ?? 1;
        }

        const normalizeY = (val: number) => {
          const normalized = (val - renderMin) / (renderMax - renderMin);
          return height - (Math.max(0, Math.min(1, normalized)) * height);
        };

        const points = history.map((val, i) => {
          const x = (i / (historySize - 1)) * width;
          const y = normalizeY(val);
          return `${x},${y}`;
        });

        return points.length > 0 ? `M ${points.join(' L ')}` : '';
    }

    // Curve Mode
    const { domain, range } = this.config;
    if (!domain || !range) return '';

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
            if (steps <= 1) normY = 0;
            else normY = Math.floor(t * steps) / (steps - 1);
            if (t >= 0.999) normY = 1;
            break;
          case 'sin':
            normY = -(Math.cos(Math.PI * t) - 1) / 2;
            break;
          case 'quad':
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

  private evaluateCurve(t: number): number {
    if (!this.config || !this.config.segments) return 0;

    const { range, segments } = this.config;
    const [minY, maxY] = range || [0, 1];

    // Find segment
    const totalWeight = this.totalWeight;
    const targetWeight = t * totalWeight;

    let currentWeight = 0;
    let matchedSegment = segments[segments.length - 1];
    let segmentStartWeight = 0;

    for (const segment of segments) {
        if (targetWeight >= currentWeight && targetWeight <= currentWeight + segment.weight) {
            matchedSegment = segment;
            segmentStartWeight = currentWeight;
            break;
        }
        currentWeight += segment.weight;
    }

    // Local T
    const segmentWidthWeight = matchedSegment.weight;
    const localT = (targetWeight - segmentStartWeight) / segmentWidthWeight;

    // Evaluate
    let normY = 0;
    const curve = matchedSegment.curve;
    const steps = curve.type === 'step' ? (curve.value ?? 2) : 1;

    switch (curve.type) {
      case 'exponential':
        const exponent = Math.pow(10, -(curve.value ?? 0));
        normY = Math.pow(localT, exponent);
        break;
      case 'linear':
        normY = localT;
        break;
      case 'step':
        if (steps <= 1) normY = 0;
        else normY = Math.floor(localT * steps) / (steps - 1);
        if (localT >= 0.999) normY = 1;
        break;
      case 'sin':
        normY = -(Math.cos(Math.PI * localT) - 1) / 2;
        break;
      case 'quad':
        normY = localT * localT;
        break;
      case 'points':
         if (curve.points && curve.points.length > 0) {
             const points = curve.points;
             if (localT <= points[0].x) normY = points[0].y;
             else if (localT >= points[points.length - 1].x) normY = points[points.length - 1].y;
             else {
                 for (let i = 0; i < points.length - 1; i++) {
                     const p1 = points[i];
                     const p2 = points[i+1];
                     if (localT >= p1.x && localT <= p2.x) {
                         const lt = (localT - p1.x) / (p2.x - p1.x);
                         normY = p1.y + lt * (p2.y - p1.y);
                         break;
                     }
                 }
             }
         } else {
             normY = localT;
         }
         break;
      default:
        normY = localT;
    }

    return minY + normY * (maxY - minY);
  }

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

    if (this.config.mode === 'scope') {
        const range = this.config.autoRange ? this.getDisplayRange() : ((this.config.range?.[1] ?? 1) - (this.config.range?.[0] ?? 0));
        const anchor = this.config.autoRange ? this.getDisplayAnchor() : (this.config.range?.[0] ?? 0);

        let renderMin: number, renderMax: number;
        if (this.config.autoRange) {
            if (this.isSigned) {
                renderMin = anchor - range / 2;
                renderMax = anchor + range / 2;
            } else {
                renderMin = anchor;
                renderMax = anchor + range;
            }
        } else {
            renderMin = this.config.range?.[0] ?? 0;
            renderMax = this.config.range?.[1] ?? 1;
        }

        const normalizeY = (val: number) => {
          const normalized = (val - renderMin) / (renderMax - renderMin);
          return height - (Math.max(0, Math.min(1, normalized)) * height);
        };

        const zeroY = normalizeY(0);

        // Grid Lines
        const gridLines = [];
        if (this.config.showGrid) {
            const maxAbs = Math.max(Math.abs(renderMin), Math.abs(renderMax));
            const maxPow = Math.ceil(Math.log2(maxAbs));
            const minPow = Math.floor(Math.log2(range)) - 4;

            for (let p = minPow; p <= maxPow; p++) {
              const val = Math.pow(2, p);
              if (val <= renderMax && val >= renderMin) gridLines.push(normalizeY(val));
              if (-val <= renderMax && -val >= renderMin) gridLines.push(normalizeY(-val));
            }
        }

        return html`
          <svg viewBox="0 0 220 96" preserveAspectRatio="none">
                <defs>
                    <pattern id="grid-x" width="24" height="96" patternUnits="userSpaceOnUse">
                        <path d="M 0 0 L 0 96" fill="none" class="grid-pattern" />
                    </pattern>
                    <pattern id="hash-pattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="var(--accent-color)" stroke-width="4" opacity="0.1" />
                    </pattern>
                    ${this.config?.cursor !== undefined ? svg`
                        <clipPath id="clip-left">
                            <rect x="0" y="0" width="${this.config.cursor * 220}" height="96" />
                        </clipPath>
                        <clipPath id="clip-right">
                            <rect x="${this.config.cursor * 220}" y="0" width="${220 - (this.config.cursor * 220)}" height="96" />
                        </clipPath>
                    ` : ''}
                </defs>
                <rect width="100%" height="100%" fill="url(#grid-x)" />
                ${gridLines.map(y => svg`<line class="grid" x1="0" y1="${y}" x2="220" y2="${y}" />`)}
                <line class="zero-line" x1="0" y1="${zeroY}" x2="220" y2="${zeroY}" />

                <!-- Curve Fills -->
                ${this.config?.cursor !== undefined ? svg`
                    <!-- Left (Solid) -->
                    <path d="${this.pathData} L 220 ${height} L 0 ${height} Z"
                          fill="var(--accent-color)" fill-opacity="0.2"
                          clip-path="url(#clip-left)" />

                    <!-- Right (Hashed) -->
                    <path d="${this.pathData} L 220 ${height} L 0 ${height} Z"
                          fill="url(#hash-pattern)"
                          clip-path="url(#clip-right)" />
                ` : svg`
                    <!-- Default Fill if no cursor -->
                    <path d="${this.pathData} L 220 ${height} L 0 ${height} Z"
                          fill="var(--accent-color)" fill-opacity="0.1" />
                `}

                <!-- Curve Stroke -->
                <path class="curve" d="${this.pathData}" fill="none" stroke="#00ff88" stroke-width="2" vector-effect="non-scaling-stroke" />

                <!-- Parameter Handles -->
                ${this.config?.segments?.map((segment, i) => {
                    if (!this.config?.interactive) return '';

                    const l = this.segmentLayout[i];
                    if (!l) return '';

                    const { startX, endX } = l;

                    // Only calculate handle for exponential curves
                    let handleY = 0;
                    let showHandle = false;

                    if (segment.curve.type === 'exponential') {
                        // Map segment.curve.value [-1, 1] to SVG Y coordinate [0, height]
                        // value = 1 - 2*t
                        // 2*t = 1 - value
                        // t = (1 - value) / 2
                        const t = (1 - (segment.curve.value ?? 0)) / 2;
                        handleY = t * height;
                        showHandle = true;
                    }

                    return showHandle ? svg`
                        <g class="parameter-control">
                            <!-- Vertical Sheer Bar -->
                            <rect class="parameter-bg" x="${startX}" y="0" width="${endX - startX}" height="${height}" />

                            <!-- Horizontal Solid Line -->
                            <line class="parameter-line" x1="${startX}" y1="${handleY}" x2="${endX}" y2="${handleY}" />

                            <!-- Handle Circle -->
                            <circle class="parameter-handle" cx="${startX + (endX - startX) / 2}" cy="${handleY}" r="4" />
                        </g>
                    ` : '';
                })}
          </svg>
        `;
    }

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
                    <pattern id="hash-pattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="var(--accent-color)" stroke-width="4" opacity="0.1" />
                    </pattern>
                    ${this.config?.cursor !== undefined ? svg`
                        <clipPath id="clip-left">
                            <rect x="0" y="0" width="${this.config.cursor * 220}" height="96" />
                        </clipPath>
                        <clipPath id="clip-right">
                            <rect x="${this.config.cursor * 220}" y="0" width="${220 - (this.config.cursor * 220)}" height="96" />
                        </clipPath>
                    ` : ''}
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
                            <g class="parameter-control">
                                <!-- Vertical Sheer Bar (Fill from bottom) -->
                                <rect class="parameter-bg" x="${startX}" y="${handleY}" width="${endX - startX}" height="${height - handleY}" />

                                <!-- Horizontal Solid Line -->
                                <line class="parameter-line" x1="${startX}" y1="${handleY}" x2="${endX}" y2="${handleY}" />
                            </g>
                        ` : ''}
                    `;
    })}

                <!-- Curve Fills -->
                ${this.config?.cursor !== undefined ? svg`
                    <!-- Left (Solid) -->
                    <path d="${this.pathData} L 220 ${height} L 0 ${height} Z"
                          fill="var(--accent-color)" fill-opacity="0.2"
                          clip-path="url(#clip-left)" />

                    <!-- Right (Hashed) -->
                    <path d="${this.pathData} L 220 ${height} L 0 ${height} Z"
                          fill="url(#hash-pattern)"
                          clip-path="url(#clip-right)" />
                ` : svg`
                    <!-- Default Fill if no cursor -->
                    <path d="${this.pathData} L 220 ${height} L 0 ${height} Z"
                          fill="var(--accent-color)" fill-opacity="0.1" />
                `}

                <!-- Curve Stroke -->
                <path class="curve" d="${this.pathData}" fill="none" />

                <!-- Cursor -->
                ${this.config?.cursor !== undefined ? (() => {
                    const cursorX = this.config.cursor * 220;
                    const valY = this.evaluateCurve(this.config.cursor);

                    // Normalize Y for SVG (0 at bottom? No, 0 at top in SVG usually, but we inverted it?)
                    // In pathData: svgY = height - (normalize(yVal) * height)
                    const [minY, maxY] = this.config.range || [0, 1];
                    const normalizedY = (valY - minY) / (maxY - minY);
                    const cursorY = height - (Math.max(0, Math.min(1, normalizedY)) * height);

                    return svg`
                        <!-- Vertical Line -->
                        <line class="cursor-line"
                            x1="${cursorX}" y1="0"
                            x2="${cursorX}" y2="${height}"
                            stroke="var(--accent-color)" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"
                            style="pointer-events: none;"
                        />
                        <!-- Intersection Point -->
                        <circle cx="${cursorX}" cy="${cursorY}" r="3" fill="var(--accent-color)" stroke="var(--node-bg)" stroke-width="1" style="pointer-events: none;" />
                    `;
                })() : ''}
            </svg>
        `;
  }
}
