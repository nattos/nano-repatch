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
| **`NODE_WIDTH`** | **`240px`** | Total width of the node (Border Box). |
| **`NODE_PADDING`** | **`7px`** | Internal padding of the node (effective content offset). |
| **`HEADER_HEIGHT`** | **`30px`** | Effective visual height of the header (top of first port row). |
| **`CONTENT_WIDTH`** | **`220px`** | Available width for content (`NODE_WIDTH` - 2 * `NODE_PADDING` approx). |
| **`PIP_OFFSET_X`** | **`-9px`** | Horizontal offset from the **Main Content Left Edge** to the **Center** of the input pip. |
| **`PIP_OFFSET_Y`** | **`12px`** | Vertical offset from the top of the port row to the center of the pip. |

## Port Label Metrics

| Metric | Value | Description |
| :--- | :--- | :--- |
| **`LABEL_HEIGHT`** | **`24px`** | Height of the label container (matches `PORT_ROW_HEIGHT`). |
| **`LABEL_FONT_SIZE`** | **`0.7em`** | Font size for port labels. |
| **`LABEL_PADDING`** | **`0 5px`** | Padding inside the label container. |
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
