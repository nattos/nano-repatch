import { css } from 'lit';

export const globalStyles = css`
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

    color: var(--app-text-color2);
    font-family: Questrial, "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 16px;
  }
`;
