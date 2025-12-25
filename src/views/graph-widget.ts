import { html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { formatValue } from './formatters';
import { NODE_CONTENT_WIDTH } from '../constants';
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
  envelopeNodes?: { id: string, x: number, y: number }[];
  interactive?: boolean;
  onSegmentChange?: (segmentId: string, param: string, value: number) => void;
  onEnvelopeChange?: (nodes: { id: string, x: number, y: number }[], segments: GraphSegment[]) => void;
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
    const width = NODE_CONTENT_WIDTH;
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

    if (this.config.envelopeNodes && this.config.envelopeNodes.length > 0) {
      return this.getEnvelopePathData();
    }

    if (this.config.mode === 'scope') {
      const history = this.history;
      const width = NODE_CONTENT_WIDTH;
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

    // Ensure start point is at X=0
    if (points.length > 0) {
      const firstPt = points[0];
      if (firstPt[0] > 0.001) {
        points.unshift([0, firstPt[1]]);
      }

      // Ensure end point is at X=width
      const width = NODE_CONTENT_WIDTH; // Standardized width
      const lastPt = points[points.length - 1];
      if (lastPt[0] < width - 0.001) {
        points.push([width, lastPt[1]]);
      }
    }

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
            // ... existing parameter change logic ...
            const rect = this.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const clampedY = Math.max(0, Math.min(height, y));
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
        return;
      }
    }

    // Envelope Segment Dragging (Proximity)
    if (this.config.envelopeNodes && this.config.segments) {
      const t = startX / width; // startX is e.clientX - rect.left from above
      const y = e.clientY - rect.top;
      const [minY, maxY] = this.config.range || [0, 1];

      const clickedValue = minY + ((height - y) / height) * (maxY - minY);
      const expectedY = this.evaluateEnvelopeAt(t);

      const thresholdY = (10 / height) * (maxY - minY);

      if (Math.abs(clickedValue - expectedY) < thresholdY) {
        const { envelopeNodes } = this.config;
        let segmentIndex = -1;
        for (let i = 0; i < envelopeNodes.length - 1; i++) {
          if (t >= envelopeNodes[i].x && t <= envelopeNodes[i + 1].x) {
            segmentIndex = i;
            break;
          }
        }

        if (segmentIndex !== -1) {
          if (e.altKey) {
            this.startCurveBend(e, segmentIndex);
          } else {
            this.startSegmentDrag(e, segmentIndex);
          }
          return;
        }
      }
    }
  }



  @observable
  hoveredSegmentIndex = -1;

  @observable
  hoveredSplitIndex = -1;

  @observable
  selectedNodeId: string | null = null;

  @observable
  hoveredNodeId: string | null = null;

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
              const p2 = points[i + 1];
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
    if (!this.config?.interactive) return;

    this.style.cursor = 'default';

    // 1. Check Envelope Mode Interactions (Points/Lines)
    if (this.config.envelopeNodes && this.config.segments) {
      const rect = this.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const height = rect.height;
      const width = rect.width; // Use widget width
      const [minY, maxY] = this.config.range || [0, 1];

      const t = x / width;
      const cursorValue = minY + ((height - y) / height) * (maxY - minY);
      const expectedY = this.evaluateEnvelopeAt(t);

      const thresholdY = (10 / height) * (maxY - minY);

      if (Math.abs(cursorValue - expectedY) < thresholdY) {
        this.style.cursor = 'ns-resize'; // Vertical resize cursor for adding points
        runInAction(() => {
          this.hoveredSegmentIndex = -1;
          this.hoveredSplitIndex = -1;
        });
        return; // Prioritize envelope interaction
      }
    }

    // 2. Check Standard Segment Mode Interactions (Splits)
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
        runInAction(() => {
          this.hoveredSplitIndex = i;
          this.hoveredSegmentIndex = -1;
        });
        this.style.cursor = 'col-resize';
        return;
      }
    }

    // Check for segment hover
    const segmentIndex = layout.findIndex(l => x >= l.startX && x <= l.endX);
    if (segmentIndex !== -1) {
      runInAction(() => {
        this.hoveredSegmentIndex = segmentIndex;
      });
    }
  }

  @action
  private handlePointerLeave() {
    this.hoveredSegmentIndex = -1;
    this.hoveredSplitIndex = -1;
  }


  private getEnvelopePathData() {
    if (!this.config || !this.config.envelopeNodes || !this.config.segments) return '';
    const { envelopeNodes, segments, range } = this.config;
    const [minY, maxY] = range || [0, 1];
    const width = NODE_CONTENT_WIDTH;
    const height = 96;

    const normalizeX = (val: number) => val * width;
    const normalizeY = (val: number) => height - ((val - minY) / (maxY - minY)) * height;

    const points: [number, number][] = [];

    // Iterate through nodes and segments
    for (let i = 0; i < envelopeNodes.length - 1; i++) {
      const p1 = envelopeNodes[i];
      const p2 = envelopeNodes[i + 1];
      const segment = segments[i];

      const startX = normalizeX(p1.x);
      // Start Y is dependent on p1

      // Calculate steps for this segment
      const steps = 20;

      let curveType = 'linear';
      let curveValue = 0;

      if (segment) {
        curveType = segment.curve.type;
        curveValue = segment.curve.value ?? 0;
      }

      // Draw points for this segment
      for (let j = 0; j < steps; j++) {
        const t = j / steps;

        // Calculate local curve value (0-1)
        let normY = 0;
        switch (curveType) {
          case 'exponential':
            const exponent = Math.pow(10, -curveValue);
            normY = Math.pow(t, exponent);
            break;
          case 'linear':
            normY = t;
            break;
          case 'step':
            const s = curveValue; // count
            if (s <= 1) normY = 0;
            else normY = Math.floor(t * s) / (s - 1);
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

        // Map normY to Y range of this segment [p1.y, p2.y]
        const yVal = p1.y + normY * (p2.y - p1.y);

        // Map t to X range [p1.x, p2.x]
        const xVal = p1.x + t * (p2.x - p1.x);

        points.push([normalizeX(xVal), normalizeY(yVal)]);
      }
    }

    // Add the very last point
    if (envelopeNodes.length > 0) {
      const last = envelopeNodes[envelopeNodes.length - 1];
      points.push([normalizeX(last.x), normalizeY(last.y)]);
    }

    // Extend to edges
    if (points.length > 0) {
      // Extend Left
      if (points[0][0] > 0.001) {
        points.unshift([0, points[0][1]]);
      }
      // Extend Right
      if (points[points.length - 1][0] < width - 0.001) {
        points.push([width, points[points.length - 1][1]]);
      }
    }

    return `M ${points.map(p => p.join(',')).join(' L ')}`;
  }




  private renderEnvelopeNodes(height: number, minY: number, maxY: number) {
    if (!this.config?.envelopeNodes) return '';

    // Normalize logic must match getEnvelopePathData
    const normalizeY = (val: number) => height - ((val - minY) / (maxY - minY)) * height;
    const normalizeX = (val: number) => val * NODE_CONTENT_WIDTH;

    return this.config.envelopeNodes.map(node => {
      const cx = normalizeX(node.x);
      const cy = normalizeY(node.y);
      const isSelected = node.id === this.selectedNodeId;
      const isHovered = node.id === this.hoveredNodeId;

      return svg`
            <g class="envelope-node"
               style="cursor: pointer;"
               @pointerdown=${(e: PointerEvent) => this.handleNodePointerDown(e, node)}
               @dblclick=${(e: MouseEvent) => this.handleNodeDoubleClick(e, node)}
               @pointerover=${() => runInAction(() => this.hoveredNodeId = node.id)}
               @pointerout=${() => runInAction(() => this.hoveredNodeId = null)}
            >
                <circle cx="${cx}" cy="${cy}" r="${isHovered || isSelected ? 6 : 4}"
                        fill="${isSelected ? '#fff' : 'var(--accent-color)'}"
                        stroke="black" stroke-width="1" />

                <!-- Expanded hit area -->
                <circle cx="${cx}" cy="${cy}" r="12" fill="red" fill-opacity="0" style="pointer-events: all;" />
            </g>
        `;
    });
  }



  private startCurveBend(e: PointerEvent, index: number) {
    const segments = this.config?.segments;
    if (!segments) return;
    if (!segments) return;
    const segment = segments[index];
    const startValue = segment.curve.value || 0;

    // Auto-switch to exponential if linear?
    // For now, let's assume it only works if parameterizable.
    // But user experience: allow switching?
    // Let's just update the value. If rendering ignores it (linear), so be it.
    // Ideally we switch to default curve type 'exponential' if currently linear?

    if (this.config?.onInteractionStart) this.config.onInteractionStart();

    new PointerDragOp(e, this, {
      move: (_ev, totalDelta) => {
        // Drag up/down to change value
        // Divisor: 100 (shift) vs 50 (default 2x speed)
        const divisor = _ev.shiftKey ? 100 : 50;
        // Direction reversed: totalDelta[1] is positive down. Drag down -> Increase value.
        // User asked to reverse direction of editing "curve".
        // Previous: -totalDelta[1] / 100. (Drag Up -> +)
        // Reverse again (as per recent request): -totalDelta[1] / divisor. (Drag Up -> +)
        const delta = -totalDelta[1] / divisor;
        const newValue = startValue + delta;

        const newSegments = [...(this.config?.segments || [])];
        // Ensure we copy the segment object too
        newSegments[index] = {
          ...newSegments[index],
          curve: { ...newSegments[index].curve, value: newValue }
        };

        // If linear, maybe switch to exponential for feedback?
        if (newSegments[index].curve.type === 'linear') {
          newSegments[index].curve.type = 'exponential';
        }

        if (this.config?.onEnvelopeChange && this.config.envelopeNodes) {
          this.config.onEnvelopeChange(this.config.envelopeNodes, newSegments);
        }
      },
      complete: () => {
        if (this.config?.onInteractionEnd) this.config.onInteractionEnd();
      }
    });
  }

  private startSegmentDrag(e: PointerEvent, index: number) {
    const envelopeNodes = this.config?.envelopeNodes;
    if (!envelopeNodes) return;
    if (!envelopeNodes) return;
    const n1 = envelopeNodes[index];
    const n2 = envelopeNodes[index + 1];

    const startX1 = n1.x;
    const startY1 = n1.y;
    const startX2 = n2.x;
    const startY2 = n2.y;

    new PointerDragOp(e, this, {
      move: (ev, totalDelta) => {
        const rect = this.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const [minY, maxY] = this.config?.range || [0, 1];

        // Segment drag is VERTICAL ONLY
        let dx = 0;
        let dy = -(totalDelta[1] / height) * (maxY - minY);

        if (ev.shiftKey) { dy *= 0.1; }

        // Y constraints [minY, maxY]
        // n1.y + dy in range
        // n2.y + dy in range

        // Check bounds for both
        if (startY1 + dy < minY) dy = minY - startY1;
        if (startY1 + dy > maxY) dy = maxY - startY1;
        if (startY2 + dy < minY) dy = minY - startY2;
        if (startY2 + dy > maxY) dy = maxY - startY2;

        const newNodes = [...envelopeNodes];
        newNodes[index] = { ...newNodes[index], x: startX1 + dx, y: startY1 + dy };
        newNodes[index + 1] = { ...newNodes[index + 1], x: startX2 + dx, y: startY2 + dy };

        if (this.config?.onEnvelopeChange) {
          this.config.onEnvelopeChange(newNodes, this.config.segments || []);
        }
      }
    });
  }

  private handleNodePointerDown(e: PointerEvent, node: any) {
    e.stopPropagation(); // Prevent canvas drag
    // Prevent default browser drag behavior
    e.preventDefault();

    runInAction(() => {
      this.selectedNodeId = node.id;
    });

    if (!this.config?.interactive || !this.config.envelopeNodes) return;

    // Capture initial state for Alt-Drag (restore capability + breakthrough)
    // We MUST use a fresh copy of the "STARTING" state for the duration of the drag.
    // Deep copy essential to not mutate initial state during drag updates.
    const initialNodes = this.config.envelopeNodes.map(n => ({ ...n }));
    const initialSegments = (this.config.segments || []).map(s => ({ ...s, curve: { ...s.curve } }));

    const draggedNodeId = node.id;
    const initialDragNode = initialNodes.find(n => n.id === draggedNodeId)!;
    const startXNorm = initialDragNode.x;
    const startYNorm = initialDragNode.y;

    if (this.config.onInteractionStart) this.config.onInteractionStart();

    new PointerDragOp(e, this, {
      move: (ev, totalDelta) => {
        const rect = this.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        const [minY, maxY] = this.config?.range || [0, 1];
        const [minOut, maxOut] = [minY, maxY];

        // Calculate delta in normalized space
        let dx = totalDelta[0] / width;
        let dy = -(totalDelta[1] / height) * (maxOut - minOut);

        if (ev.shiftKey) { dx *= 0.1; dy *= 0.1; }

        let newX = startXNorm + dx;
        let newY = startYNorm + dy;
        newY = Math.max(minOut, Math.min(maxOut, newY));

        if (ev.altKey) {
          // ALT DRAG: Break Through Mode
          newX = Math.max(0, Math.min(1, newX));

          // Filter: Keep nodes NOT within sweep range [startX, newX]
          const activeNodes = initialNodes.filter(n => {
            if (n.id === draggedNodeId) return true;
            if (newX > startXNorm) { // Moving Right
              return !(n.x > startXNorm && n.x <= newX);
            } else { // Moving Left
              return !(n.x >= newX && n.x < startXNorm);
            }
          }).map(n => {
            if (n.id === draggedNodeId) return { ...n, x: newX, y: newY };
            return n;
          });
          activeNodes.sort((a, b) => a.x - b.x);

          // Reconstruct segments
          const activeSegments: any[] = [];
          for (let i = 0; i < activeNodes.length - 1; i++) {
            const u = activeNodes[i];
            // Try to find the segment that started at this node originally
            const originalIndex = initialNodes.findIndex(n => n.id === u.id);
            if (originalIndex !== -1 && originalIndex < initialSegments.length) {
              activeSegments.push(initialSegments[originalIndex]);
            } else {
              // Fallback using default. Note: Logic should try to preserve curves.
              // If we removed nodes, we are skipping from A to C.
              // We use A's outgoing segment (originally A->B).
              activeSegments.push({ id: `s-gen-${Math.random()}`, weight: 1, curve: { type: 'linear', value: 0 } });
            }
          }

          if (this.config?.onEnvelopeChange) {
            this.config.onEnvelopeChange(activeNodes, activeSegments);
          }

        } else {
          // STANDARD MODE: Constrained by *initial* neighbors (snap back if Alt released)

          const idx = initialNodes.findIndex(n => n.id === draggedNodeId);
          const prev = initialNodes[idx - 1];
          const next = initialNodes[idx + 1];

          const minX = prev ? prev.x : 0;
          const maxX = next ? next.x : 1;

          // Clamp X
          const clampedX = Math.max(minX, Math.min(maxX, newX));

          const activeNodes = initialNodes.map(n => {
            if (n.id === draggedNodeId) return { ...n, x: clampedX, y: newY };
            return n;
          });

          if (this.config?.onEnvelopeChange) {
            this.config.onEnvelopeChange(activeNodes, initialSegments);
          }
        }
      },
      complete: () => {
        if (this.config?.onInteractionEnd) this.config.onInteractionEnd();
      }
    });
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
          <svg viewBox="0 0 ${NODE_CONTENT_WIDTH} 96" preserveAspectRatio="none">
                <defs>
                    <pattern id="grid-x" width="24" height="96" patternUnits="userSpaceOnUse">
                        <path d="M 0 0 L 0 96" fill="none" class="grid-pattern" />
                    </pattern>
                    <pattern id="hash-pattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke="var(--accent-color)" stroke-width="4" opacity="0.1" />
                    </pattern>
                    ${this.config?.cursor !== undefined ? svg`
                        <clipPath id="clip-left">
                            <rect x="0" y="0" width="${this.config.cursor * NODE_CONTENT_WIDTH}" height="96" />
                        </clipPath>
                        <clipPath id="clip-right">
                            <rect x="${this.config.cursor * NODE_CONTENT_WIDTH}" y="0" width="${NODE_CONTENT_WIDTH - (this.config.cursor * NODE_CONTENT_WIDTH)}" height="96" />
                        </clipPath>
                    ` : ''}
                </defs>
                <rect width="100%" height="100%" fill="url(#grid-x)" />
                ${gridLines.map(y => svg`<line class="grid" x1="0" y1="${y}" x2="${NODE_CONTENT_WIDTH}" y2="${y}" />`)}
                <line class="zero-line" x1="0" y1="${zeroY}" x2="${NODE_CONTENT_WIDTH}" y2="${zeroY}" />

                <!-- Curve Fills -->
                ${this.config?.cursor !== undefined ? (this.pathData ? svg`
                    <!-- Left (Solid) -->
                    <path d="${this.pathData} L ${NODE_CONTENT_WIDTH} ${height} L 0 ${height} Z"
                          fill="var(--accent-color)" fill-opacity="0.2"
                          clip-path="url(#clip-left)" />

                    <!-- Right (Hashed) -->
                    <path d="${this.pathData} L ${NODE_CONTENT_WIDTH} ${height} L 0 ${height} Z"
                          fill="url(#hash-pattern)"
                          clip-path="url(#clip-right)" />
                ` : '') : (this.pathData ? svg`
                    <!-- Default Fill if no cursor -->
                    <path d="${this.pathData} L ${NODE_CONTENT_WIDTH} ${height} L 0 ${height} Z"
                          fill="var(--accent-color)" fill-opacity="0.1" />
                ` : '')}

                <!-- Curve Stroke -->
                <path class="curve" d="${this.pathData}" fill="none" stroke="#00ff88" stroke-width="2" vector-effect="non-scaling-stroke" />
          </svg>
        `;
    }

    const layout = this.segmentLayout;
    const resizeThreshold = 10;
    const [minY, maxY] = this.config.range || [0, 1];

    return html`
            <svg viewBox="0 0 ${NODE_CONTENT_WIDTH} 96" preserveAspectRatio="none"
                @pointerdown=${(e: PointerEvent) => this.handlePointerDown(e)}
                @pointermove=${(e: PointerEvent) => this.handlePointerMove(e)}
                @pointerleave=${() => this.handlePointerLeave()}
                @dblclick=${(e: MouseEvent) => this.handleDoubleClick(e)}
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
                            <rect x="0" y="0" width="${this.config.cursor * NODE_CONTENT_WIDTH}" height="96" />
                        </clipPath>
                        <clipPath id="clip-right">
                            <rect x="${this.config.cursor * NODE_CONTENT_WIDTH}" y="0" width="${NODE_CONTENT_WIDTH - (this.config.cursor * NODE_CONTENT_WIDTH)}" height="96" />
                        </clipPath>
                    ` : ''}
                    <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="var(--accent-color)" stop-opacity="0.2" />
                        <stop offset="100%" stop-color="var(--accent-color)" stop-opacity="0.0" />
                    </linearGradient>
                </defs>

                <rect width="100%" height="100%" fill="url(#grid)" />

                <!-- Axis Lines -->
                <line class="axis-line" x1="0" y1="${height / 2}" x2="${NODE_CONTENT_WIDTH}" y2="${height / 2}" />

                <!-- Axis Lines -->
                <line class="axis-line" x1="0" y1="${height / 2}" x2="${NODE_CONTENT_WIDTH}" y2="${height / 2}" />

                <!-- Segments (for non-envelope mode) -->
                ${!this.config.envelopeNodes ?
        layout.map(l => {
          const { segment, startX, endX } = l;
          const isHovered = l.index === this.hoveredSegmentIndex;
          const isSplitHovered = l.index === this.hoveredSplitIndex;

          // Only calculate handle for exponential curves
          let handleY = 0;
          let showHandle = false;

          if (segment.curve.type === 'exponential') {
            const tHandle = (1 - (segment.curve.value ?? 0)) / 2;
            handleY = tHandle * height;
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
        }) : ''
      }

                <!-- Curve Fills -->
                ${this.config?.cursor !== undefined ? svg`
                    <!-- Left (Solid) -->
                    <path d="${this.pathData} L ${NODE_CONTENT_WIDTH} ${height} L 0 ${height} Z"
                          fill="var(--accent-color)" fill-opacity="0.2"
                          clip-path="url(#clip-left)" />

                    <!-- Right (Hashed) -->
                    <path d="${this.pathData} L ${NODE_CONTENT_WIDTH} ${height} L 0 ${height} Z"
                          fill="url(#hash-pattern)"
                          clip-path="url(#clip-right)" />
                ` : svg`
                    <!-- Default Fill if no cursor -->
                    <path d="${this.pathData} L ${NODE_CONTENT_WIDTH} ${height} L 0 ${height} Z"
                          fill="var(--accent-color)" fill-opacity="0.1" />
                `}

                <!-- Curve Stroke -->
                <path class="curve" d="${this.pathData}" fill="none" />

                <!-- Envelope Nodes (Render ON TOP) -->
                ${this.config.envelopeNodes ? this.renderEnvelopeNodes(height, minY, maxY) : ''}


                <!-- Cursor -->
                ${this.config?.cursor !== undefined ? (() => {
        const cursorX = this.config.cursor * NODE_CONTENT_WIDTH;
        const valY = this.evaluateCurve(this.config.cursor);

        // Normalize Y for SVG
        const [minY, maxY] = this.config.range || [0, 1];
        const normalizedY = (valY - minY) / (maxY - minY);
        const cursorY = height - (Math.max(0, Math.min(1, normalizedY)) * height);

        return svg`
                        <line x1="${cursorX}" y1="0" x2="${cursorX}" y2="96" stroke="white" stroke-width="1" />
                        <circle cx="${cursorX}" cy="${cursorY}" r="3" fill="white" />
                    `;
      })() : ''}
            </svg>
        `;
  }

  private evaluateEnvelopeAt(t: number): number {
    if (!this.config || !this.config.envelopeNodes || !this.config.segments) return 0;
    const { envelopeNodes, segments } = this.config;

    // Find segment
    for (let i = 0; i < envelopeNodes.length - 1; i++) {
      const p1 = envelopeNodes[i];
      const p2 = envelopeNodes[i + 1];

      if (t >= p1.x && t <= p2.x) {
        const segment = segments[i];
        const duration = p2.x - p1.x;
        if (duration <= 1e-6) return p1.y;

        const localT = (t - p1.x) / duration;
        let normY = 0;
        const curve = segment.curve;

        // Re-implement basic curve math or refactor? Copy-paste for now to ensure self-contained helper
        switch (curve.type) {
          case 'exponential':
            const exponent = Math.pow(10, -(curve.value ?? 0));
            normY = Math.pow(localT, exponent);
            break;
          case 'linear': normY = localT; break;
          case 'step':
            const s = curve.value ?? 2;
            if (s <= 1) normY = 0;
            else normY = Math.floor(localT * s) / (s - 1);
            if (localT >= 0.999) normY = 1;
            break;
          case 'sin': normY = -(Math.cos(Math.PI * localT) - 1) / 2; break;
          case 'quad': normY = localT * localT; break;
          default: normY = localT;
        }

        return p1.y + normY * (p2.y - p1.y);
      }
    }
    return 0; // Fallback
  }

  private handleNodeDoubleClick(e: MouseEvent, node: any) {
    if (!this.config?.interactive || !this.config.envelopeNodes) return;

    // STOP PROPAGATION IS CRITICAL
    e.stopPropagation();
    e.preventDefault();

    const { envelopeNodes } = this.config;
    // Prevent deleting start/end nodes
    if (node.id === envelopeNodes[0].id || node.id === envelopeNodes[envelopeNodes.length - 1].id) return;

    const index = envelopeNodes.findIndex(n => n.id === node.id);
    if (index === -1) return;

    const newNodes = [...envelopeNodes];
    newNodes.splice(index, 1);

    const newSegments = [...(this.config.segments || [])];

    // We have N nodes and N-1 segments.
    // Nodes: 0, 1, 2. Segments: S0 (0-1), S1 (1-2).
    // Delete Node 1 (index 1).
    // We want to keep S0 to connect Node 0 -> Node 2.
    // So distinctively remove S1 (index 1).
    if (newSegments.length >= index) {
      newSegments.splice(index, 1);
    }

    if (this.config.onEnvelopeChange) {
      this.config.onEnvelopeChange(newNodes, newSegments);
    }
  }

  private handleDoubleClick(e: MouseEvent) {
    e.stopPropagation();


    if (!this.config?.interactive || !this.config.envelopeNodes || !this.config.segments) return;

    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    const t = x / width;
    const [minY, maxY] = this.config.range || [0, 1];

    // Correct Y mapping: svgY -> 0..height mapping to value range
    // value = min + (1 - svgY/height) * (max - min)
    const clickedValue = minY + ((height - y) / height) * (maxY - minY);

    const expectedY = this.evaluateEnvelopeAt(t);

    // Increase threshold for better UX
    const clickThresholdPixels = 10;
    const thresholdY = (clickThresholdPixels / height) * (maxY - minY);

    const { envelopeNodes, segments } = this.config;
    let insertIndex = -1;

    for (let i = 0; i < envelopeNodes.length - 1; i++) {
      if (t >= envelopeNodes[i].x && t <= envelopeNodes[i + 1].x) {
        insertIndex = i + 1;
        break;
      }
    }

    if (insertIndex === -1) return; // Clicked outside bounds?

    const isOnLine = Math.abs(clickedValue - expectedY) < thresholdY;

    // Alt + Double Click on Segment -> Reset to Linear
    if (isOnLine && e.altKey) {
      // Find segment index
      let segmentIndex = -1;
      for (let i = 0; i < envelopeNodes.length - 1; i++) {
        if (t >= envelopeNodes[i].x && t <= envelopeNodes[i + 1].x) {
          segmentIndex = i;
          break;
        }
      }

      if (segmentIndex !== -1) {
        const newSegments = [...segments];
        newSegments[segmentIndex] = {
          ...newSegments[segmentIndex],
          curve: { type: 'linear', value: 0 }
        };
        if (this.config.onEnvelopeChange) {
          this.config.onEnvelopeChange(envelopeNodes, newSegments);
        }
        return;
      }
    }

    // If not close to line, do we simply add point at click location or snap?
    // User expects to "click line to add node". If they click far away, maybe just add node there?
    // But "Double click line" specifically implies splitting.
    // If they double click empty space, we currently add a node there.

    const finalY = isOnLine ? expectedY : clickedValue;

    const newNode = { id: `n - ${Date.now()} `, x: t, y: finalY };

    const newNodes = [...envelopeNodes];
    newNodes.splice(insertIndex, 0, newNode);

    const newSegments = [...segments];
    const oldSegment = newSegments[insertIndex - 1];
    const tailSegment = { ...oldSegment, id: `s - ${Date.now()} -A` };
    const headSegment = { id: `s - ${Date.now()} -B`, weight: 1, curve: { type: 'linear' } as any };

    newSegments.splice(insertIndex - 1, 1, tailSegment, headSegment);

    if (this.config.onEnvelopeChange) {
      this.config.onEnvelopeChange(newNodes, newSegments);
    }
  }
}
