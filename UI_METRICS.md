# UI Metrics for Custom Editors

This document defines the exact pixel metrics for custom UI editors to ensure consistent rendering across the Graph Grid and Inspector.

## Global Constants

| Constant | Value | Description |
| :--- | :--- | :--- |
| **`STANDARD_EDITOR_WIDTH`** | **`220px`** | The fixed width for all custom editors. |
| **`PORT_ROW_HEIGHT`** | **`24px`** | The fixed height for a standard port row. |
| **`PORT_PIP_SIZE`** | **`15px`** | The diameter of the port connection pip. |

## Graph Node Metrics

| Metric | Value | Description |
| :--- | :--- | :--- |
| **`NODE_WIDTH`** | **`272px`** | Total width of the node (Border Box). |
| **`NODE_PADDING_X`** | **`16px`** | Horizontal internal padding. |
| **`NODE_PADDING_Y`** | **`8px`** | Vertical internal padding. |
| **`NODE_BORDER_WIDTH`** | **`3px`** | Width of the left accent border. |
| **`HEADER_HEIGHT`** | **`24px`** | Effective visual height of the header. |
| **`CONTENT_WIDTH`** | **`240px`** | Available width for content (`NODE_WIDTH` - 2 * `NODE_PADDING_X`). |
| **`PIP_OFFSET_X`** | **`-9px`** | Horizontal offset of input pips. |
| **`PIP_OFFSET_Y`** | **`12px`** | Vertical offset of input pips. |

## Port Label Metrics

| Metric | Value | Description |
| :--- | :--- | :--- |
| **`LABEL_HEIGHT`** | **`24px`** | Height of the label container (matches `PORT_ROW_HEIGHT`). |
| **`LABEL_FONT_SIZE`** | **`0.7em`** | Font size for port labels. |
| **`LABEL_PADDING`** | **`0 5px`** | Padding inside the label container. |

## Vertical Rhythm & Grid Fit

The layout is designed so that nodes of varying sizes (Single, Double, Triple grid units) fit perfectly into the grid without slack.

*   **Row Height**: `24px`
*   **Header Height**: `24px`
*   **Bottom Padding**: `8px` (NODE_PADDING_Y)

### Height Calculation
`Total Height = Header + (Rows * 24) + Padding`
`Total Height = 24 + (Rows * 24) + 8`

### Grid Fit Verification

| Size | Grid Height | Calculation | Fits Rows | Node Height |
| :--- | :--- | :--- | :--- | :--- |
| **Single** | **80px** | `80` | **2** | `24 + 48 + 8 = 80px` |
| **Double** | **176px** | `80 + 16 + 80` | **6** | `24 + 144 + 8 = 176px` |
| **Triple** | **272px** | `176 + 16 + 80` | **10** | `24 + 240 + 8 = 272px` |

This means custom editors should aim for heights that are multiples of **24px** to maintain alignment.

| Metric | Value | Description |
| :--- | :--- | :--- |
| **`LABEL_COLOR`** | **`var(--text-muted)`** | Text color for labels. |
| **`SLIDER_LABEL_WIDTH`** | **`38px`** | Fixed width for labels inside slider editors (includes padding). |
| **`LABEL_BOX_SIZING`** | **`border-box`** | Box sizing model for labels. |
| **`LABEL_OVERFLOW`** | **`ellipsis`** | Text overflow behavior for fixed-width labels. |

## Inspector Metrics

| Metric | Value | Description |
| :--- | :--- | :--- |
| **`INSPECTOR_WIDTH`** | **`260px`** | Total width of the inspector panel. |
| **`INSPECTOR_PADDING`** | **`20px`** | Internal padding of the inspector. |
| **`CONTENT_WIDTH`** | **`220px`** | Available width for content (`INSPECTOR_WIDTH` - 2 * `INSPECTOR_PADDING`). |

## Implementation Notes

1.  **Fixed Widths**: Custom editors **MUST** be designed to fit exactly within `STANDARD_EDITOR_WIDTH` (220px). They should not rely on flexbox expansion for width.
2.  **Explicit Heights**: Custom editors **MUST** return their exact pixel height. This height will be **enforced**, and any overflowing content will be **clipped**. CSS auto-layout for height is discouraged to prevent layout thrashing.
3.  **Pip Alignment**: When rendering custom connections or overlays, use `PIP_OFFSET_X` (-9px) to align visually with the input ports.
4.  **Z-Index**: Ports and pips must always render **above** custom editors (`z-index > 0`).
5.  **Slider Labels**: Slider editors should render their own input/output labels, allocating `SLIDER_LABEL_WIDTH` (38px) on each side, ellipsizing text if necessary.
