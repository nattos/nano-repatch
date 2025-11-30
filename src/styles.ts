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
    --app-bg-color1: #222222;
    --app-bg-color2: #313131;

    /* Semantic Theme Variables */
    --bg-color: #222;
    --panel-bg: #333;
    --panel-header-bg: #2a2a2a;
    --node-bg: #333;
    --node-border: #444;
    --text-color: #ddd;
    --text-muted: #aaa;
    --border-color: #555;
    --accent-color: #00aaff;
    --selection-color: rgba(0, 170, 255, 0.5);
    --port-color: #555;
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
`];
