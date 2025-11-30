
// Grid Layout Constants
// These must match the CSS variables in src/styles.ts

export const GRID_UNIT = 80;
export const GRID_GAP = 16;
export const ROW_HEIGHT = 24;
export const HEADER_HEIGHT = 24;
export const NODE_PADDING_X = 16;
export const NODE_PADDING_Y = 8;

// Derived Constants
export const GRID_STEP = GRID_UNIT + GRID_GAP;

// Node Widths
export const NODE_WIDTH_MINIMAL = GRID_UNIT; // 80px
export const NODE_WIDTH_COMPRESSED = (GRID_UNIT * 2) + GRID_GAP; // 176px
export const NODE_WIDTH_NORMAL = (GRID_UNIT * 3) + (GRID_GAP * 2); // 272px
export const NODE_CONTENT_WIDTH = NODE_WIDTH_NORMAL - (NODE_PADDING_X * 2); // 240px

// Node Heights (Base)
export const NODE_HEIGHT_SINGLE = GRID_UNIT; // 80px
export const NODE_HEIGHT_DOUBLE = (GRID_UNIT * 2) + GRID_GAP; // 176px
export const NODE_HEIGHT_TRIPLE = (GRID_UNIT * 3) + (GRID_GAP * 2); // 272px

// UI Metrics
export const SLIDER_LABEL_WIDTH = 38;
export const SLIDER_HEIGHT = 16;
export const PIP_OFFSET_X = -9;
export const LABEL_PADDING_X = 0;
export const PORT_LABEL_PADDING = 6;
export const NODE_BORDER_WIDTH = 3;

