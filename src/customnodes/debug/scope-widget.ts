import { html, css, svg, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { widgetStyles } from '../../styles';

@customElement('scope-widget')
export class ScopeWidget extends LitElement {
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = -1;
  @property({ type: Number }) max = 1;
  @property({ type: Number }) historySize = 100;

  private history: number[] = [];

  static styles = [
    widgetStyles,
    css`
      path {
        fill: none;
        stroke: #00ff88;
        stroke-width: 2;
      }
      .zero-line {
        stroke-dasharray: 4 4;
      }
    `
  ];

  @property({ type: Boolean }) autoRange = true;

  private smoothedRange = 1.0;
  private smoothedAnchor = 0.0;
  private isSigned = false;

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('value')) {
      this.history.push(this.value);
      if (this.history.length > this.historySize) {
        this.history.shift();
      }

      if (this.autoRange) {
        this.updateAdaptiveRange();
      }

      this.requestUpdate();
    }
  }

  private updateAdaptiveRange() {
    if (this.history.length === 0) return;

    let minV = this.history[0];
    let maxV = this.history[0];
    let hasNegative = false;

    for (const v of this.history) {
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      if (v < 0) hasNegative = true;
    }

    // Latch signed mode
    if (hasNegative) this.isSigned = true;

    // Calculate required view
    // Padding: 20%
    const padding = 1.2;

    let targetRange = 1.0;
    let targetAnchor = 0.0;

    if (this.isSigned) {
      // Signed Mode: Anchor is center, Range is total height
      // View: [Anchor - Range/2, Anchor + Range/2]
      // We want to fit [minV, maxV]
      // Center of signal
      const signalCenter = (minV + maxV) / 2;
      // Span of signal
      const signalSpan = maxV - minV;
      // Max deviation from center
      const maxDev = Math.max(Math.abs(maxV - signalCenter), Math.abs(minV - signalCenter));

      // If we center on signalCenter, we need Range = 2 * maxDev
      // But we want quantized Anchor.

      // Strategy:
      // 1. Determine Range needed to cover the span (with padding)
      const requiredSpan = Math.max(signalSpan * padding, 0.001); // Avoid 0

      // Quantize Range to power of 2
      const quantizedRange = Math.pow(2, Math.ceil(Math.log2(requiredSpan)));

      // 2. Determine Anchor
      // We want Anchor to be a multiple of (Range/something)?
      // User said "Anchor... will move in quantized steps".
      // Let's say Anchor step is Range.
      const anchorStep = quantizedRange;
      const quantizedAnchor = Math.round(signalCenter / anchorStep) * anchorStep;

      // Check if this Anchor + Range fits the signal
      // View: [qAnchor - qRange/2, qAnchor + qRange/2]
      // If not, we might need to bump Range or move Anchor?
      // Actually, if we quantize Anchor, we might push signal out of view if Range is tight.
      // So maybe Range needs to be larger?
      // Let's try to fit [minV, maxV] into [A - R/2, A + R/2]

      // Let's use the Waterlevel strategy on the *parameters*
      targetRange = quantizedRange;
      targetAnchor = quantizedAnchor;

      // Ensure it fits?
      const viewMin = targetAnchor - targetRange / 2;
      const viewMax = targetAnchor + targetRange / 2;

      if (minV < viewMin || maxV > viewMax) {
         // If it doesn't fit, double the range?
         targetRange *= 2;
      }

    } else {
      // Unsigned Mode: Anchor is bottom, Range is height
      // View: [Anchor, Anchor + Range]
      // We want to fit [minV, maxV] (where minV >= 0)

      const requiredSpan = (maxV - minV) * padding;
      const requiredTop = maxV * padding; // Usually we care about max in unsigned

      // If signal is [100, 101], span is 1. We want Range 2? Anchor 100?
      // If we use Anchor 0, we need Range 128.
      // User said "Anchor... will move".

      // Let's try to find a quantized Anchor <= minV
      // And quantized Range >= maxV - Anchor

      // Heuristic:
      // Range = Power of 2 covering (maxV - minV) * padding?
      // Anchor = Multiple of Range?

      const span = Math.max(maxV - minV, 0.001);
      let qRange = Math.pow(2, Math.ceil(Math.log2(span * padding)));

      // Anchor step = qRange
      let qAnchor = Math.floor(minV / qRange) * qRange;

      // Check if maxV fits
      if (qAnchor + qRange < maxV) {
        // Doesn't fit.
        // Either move Anchor up (not possible if we want Anchor <= minV)
        // Or increase Range.
        qRange *= 2;
        // Re-quantize Anchor to new Range?
        qAnchor = Math.floor(minV / qRange) * qRange;
      }

      targetRange = qRange;
      targetAnchor = qAnchor;
    }

    // Waterlevel / Smoothing
    // Attack (expand) is instant
    // Release (shrink) is slow

    // Range Smoothing
    if (targetRange > this.smoothedRange) {
      this.smoothedRange = targetRange;
    } else {
      // Decay
      this.smoothedRange = this.smoothedRange * 0.95 + targetRange * 0.05;
      if (Math.abs(this.smoothedRange - targetRange) < 0.01) this.smoothedRange = targetRange;
    }

    // Anchor Smoothing
    // Anchor usually snaps. If we smooth it, it looks like panning.
    // User said "The anchor only moves if new values are outside...".
    // And "Waterlevel strategy to avoid the anchor moving too much".
    // This implies we hold the anchor until forced to move.

    // Let's implement "Hold until forced" for Anchor.
    // Current Display Anchor
    const currentDisplayAnchor = this.getDisplayAnchor();
    const currentDisplayRange = this.getDisplayRange();

    // Check if current view supports the signal
    let fits = false;
    if (this.isSigned) {
       const vMin = currentDisplayAnchor - currentDisplayRange / 2;
       const vMax = currentDisplayAnchor + currentDisplayRange / 2;
       // Padding zone check? "outside of a given padding zone"
       // Let's say we want signal to be within 90% of view?
       const safeZone = 0.9;
       const safeMin = currentDisplayAnchor - (currentDisplayRange * safeZone) / 2;
       const safeMax = currentDisplayAnchor + (currentDisplayRange * safeZone) / 2;

       if (minV >= safeMin && maxV <= safeMax) fits = true;
    } else {
       const vMin = currentDisplayAnchor;
       const vMax = currentDisplayAnchor + currentDisplayRange;
       const safeMin = currentDisplayAnchor; // Bottom is hard?
       const safeMax = currentDisplayAnchor + currentDisplayRange * 0.9;

       if (minV >= safeMin && maxV <= safeMax) fits = true;
    }

    if (!fits) {
       // Move anchor to target
       // We can smooth this transition too
       this.smoothedAnchor = this.smoothedAnchor * 0.8 + targetAnchor * 0.2;
       if (Math.abs(this.smoothedAnchor - targetAnchor) < 0.01) this.smoothedAnchor = targetAnchor;
    } else {
       // Keep anchor (decay towards target slowly? or just hold?)
       // "Waterlevel strategy" might mean decay.
       // Let's decay very slowly to return to "ideal" state (e.g. 0)
       this.smoothedAnchor = this.smoothedAnchor * 0.99 + targetAnchor * 0.01;
    }
  }

  private getDisplayRange() {
     return Math.pow(2, Math.ceil(Math.log2(this.smoothedRange)));
  }

  private getDisplayAnchor() {
     // Quantize anchor to... what?
     // If Range is 1, Anchor can be 0, 1, 2...
     // If Range is 128, Anchor can be 0, 128, 256...
     // Let's quantize to current DisplayRange.
     const r = this.getDisplayRange();
     return Math.round(this.smoothedAnchor / r) * r;
  }

  render() {
    const width = 220;
    const height = 96;

    const range = this.autoRange ? this.getDisplayRange() : (this.max - this.min);
    const anchor = this.autoRange ? this.getDisplayAnchor() : this.min; // Wait, min is not anchor in unsigned manual mode?

    // Manual mode: min/max are explicit.
    // Auto mode: calculated.

    let renderMin: number, renderMax: number;

    if (this.autoRange) {
        if (this.isSigned) {
            renderMin = anchor - range / 2;
            renderMax = anchor + range / 2;
        } else {
            renderMin = anchor;
            renderMax = anchor + range;
        }
    } else {
        renderMin = this.min;
        renderMax = this.max;
    }

    const normalizeY = (val: number) => {
      const normalized = (val - renderMin) / (renderMax - renderMin);
      return height - (Math.max(0, Math.min(1, normalized)) * height);
    };

    const points = this.history.map((val, i) => {
      const x = (i / (this.historySize - 1)) * width;
      const y = normalizeY(val);
      return `${x},${y}`;
    });

    const pathData = points.length > 0 ? `M ${points.join(' L ')}` : '';
    const zeroY = normalizeY(0);

    // Generate Grid Lines (Powers of 2)
    const gridLines = [];

    // Find max power of 2 needed
    const maxAbs = Math.max(Math.abs(renderMin), Math.abs(renderMax));
    const maxPow = Math.ceil(Math.log2(maxAbs));

    // Generate lines for 2^n and -2^n
    // We go down to maybe 2^-4? or just 1?
    // Let's go down to a reasonable fraction of the range
    const minPow = Math.floor(Math.log2(range)) - 4;

    for (let p = minPow; p <= maxPow; p++) {
      const val = Math.pow(2, p);

      // Positive
      if (val <= renderMax && val >= renderMin) {
        gridLines.push(normalizeY(val));
      }

      // Negative
      if (-val <= renderMax && -val >= renderMin) {
        gridLines.push(normalizeY(-val));
      }
    }

    return html`
      <svg viewBox="0 0 220 96" preserveAspectRatio="none">
        <defs>
          <pattern id="grid-x" width="24" height="96" patternUnits="userSpaceOnUse">
             <path d="M 0 0 L 0 96" fill="none" class="grid-pattern" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-x)" />
        ${gridLines.map(y => svg`<line class="grid" x1="0" y1="${y}" x2="220" y2="${y}" />`)}
        <line class="zero-line" x1="0" y1="${zeroY}" x2="220" y2="${zeroY}" />
        <path d="${pathData}" />
      </svg>
    `;
  }
}
