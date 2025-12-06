import 'line-awesome/dist/line-awesome/css/line-awesome.css';
// @ts-ignore
import lineawesomecss from 'line-awesome/dist/line-awesome/css/line-awesome.css?raw';
import { css, unsafeCSS } from 'lit';

export const globalStyles = [
  unsafeCSS(lineawesomecss),
  css`
  :host {
    --pixel: 1px;
  }
  @media (min-resolution: 2dppx) {
    :host {
      --pixel: 0.5px;
    }
  }

  :host {
    --app-color1: #FFFACD;
    --app-color2: #D87093;
    --app-color3: #444444;
    --app-hi-color1: #ff4500;
    --app-hi-color2: #4169E1;
    --app-hi-color3: #FF8C00;
    --app-hi-color4: #FFDA63;
    --app-text-color1: #DDDDDD;
    --app-text-color2: #AAAAAA;
    /* Saturated Dark Blue-Grey Backgrounds */
    --app-bg-color1: #16171a;
    --app-bg-color2: #1f2228;

    /* Semantic Theme Variables */
    --bg-color: var(--app-bg-color1);
    /* Glassy Panels */
    --panel-bg: rgba(31, 34, 40, 0.9);
    --panel-header-bg: rgba(31, 34, 40, 0.95);

    /* Glassy Nodes */
    --node-bg: rgba(31, 34, 40, 0.85);
    /* Subtle light border for glass effect */
    --node-border: rgba(255, 255, 255, 0.1);

    --text-color: var(--app-text-color1);
    --text-muted: var(--app-text-color2);
    --border-color: #555;
    --accent-color: var(--app-hi-color1);
    --selection-color: rgba(255, 69, 0, 0.2); /* app-hi-color1 with opacity */
    --selection-border: rgba(255, 69, 0, 0.6); /* app-hi-color1 with opacity */
    --port-color: #666; /* Slightly lighter for visibility on dark BG */
    --port-hover: #777;
    --port-connected: #00ff00;
    --input-bg: #444;
    --button-bg: #333;
    --button-hover: #444;
    --button-active: #222;

    /* Grid Layout Variables */
    --grid-unit: 80px;
    --grid-gap: 16px;
    --row-height: 24px;
    --header-height: 24px;
    --node-padding-x: 16px;
    --node-padding-y: 8px;

    color: var(--app-text-color2);
    font-family: Questrial, "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 16px;
  }

  .ui-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ui-list-item {
    padding: 8px;
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }

  .ui-list-item:hover {
    background-color: var(--button-hover);
  }

  .ui-list-item.selected {
    background-color: var(--selection-color);
    border: 1px solid var(--selection-border);
    color: var(--text-color);
  }

  /* Step Sequence Visualization */
  .step-seq-viz {
    display: inline-flex;
    gap: 1px;
    height: 14px;
    align-items: flex-end;
    background: rgba(0,0,0,0.3);
    padding: 2px;
    border-radius: 3px;
    vertical-align: middle;
  }

  .step-seq-viz .step {
    width: 6px;
    border-radius: 1px;
    min-height: 2px;
  }

  .step-seq-viz .step.hold {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    margin-right: -1px; /* Connect visually */
    padding-right: 1px;
    z-index: 1;
  }
`];

export const widgetStyles = css`
  :host {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--node-bg, #222);
    border: 1px solid var(--node-border, #444);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    user-select: none;
  }

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  path {
    vector-effect: non-scaling-stroke;
  }

  .grid-pattern, .grid {
    stroke: var(--grid-color, rgba(255, 255, 255, 0.05));
    stroke-width: 1;
  }

  .axis-line, .zero-line {
    stroke: var(--border-color, rgba(255, 255, 255, 0.3));
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
`;
