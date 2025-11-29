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
| **`NODE_PADDING`** | **`10px`** | Internal padding of the node. |
| **`CONTENT_WIDTH`** | **`220px`** | Available width for content (`NODE_WIDTH` - 2 * `NODE_PADDING`). |
| **`PIP_OFFSET_X`** | **`-17.5px`** | Horizontal offset from the **Content Box Left Edge** to the **Center** of the input pip. <br>Calculation: `PipLeft (-15px) + Radius (7.5px) - Padding (10px)` |
| **`PIP_OFFSET_Y`** | **`12px`** | Vertical offset from the top of the port row to the center of the pip. |

## Inspector Metrics

| Metric | Value | Description |
| :--- | :--- | :--- |
| **`INSPECTOR_WIDTH`** | **`260px`** | Total width of the inspector panel. |
| **`INSPECTOR_PADDING`** | **`20px`** | Internal padding of the inspector. |
| **`CONTENT_WIDTH`** | **`220px`** | Available width for content (`INSPECTOR_WIDTH` - 2 * `INSPECTOR_PADDING`). |

## Implementation Notes

1.  **Fixed Widths**: Custom editors **MUST** be designed to fit exactly within `STANDARD_EDITOR_WIDTH` (220px). They should not rely on flexbox expansion for width.
2.  **Explicit Heights**: Custom editors **MUST** return their exact pixel height. This height will be **enforced**, and any overflowing content will be **clipped**. CSS auto-layout for height is discouraged to prevent layout thrashing.
3.  **Pip Alignment**: When rendering custom connections or overlays, use `PIP_OFFSET_X` (-17.5px) to align visually with the input ports.
