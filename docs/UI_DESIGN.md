# UI Design & Layout

## 1. Design Philosophy

The design pillars are clean and solid behaviours. As little menu digging as possible. "Playability" like an instrument, yet uncluttered. The editor should feel like a canvas you paint on, in broad strokes.

## 2. Layout System

### The Grid Layout
The editor features a **3-column layout**:
1.  **Input Column (Left):** Pinned to the left. Contains `input` nodes.
2.  **Main Grid (Center):** Infinite scrollable grid for main logic.
3.  **Output Column (Right):** Pinned to the right. Contains `output` nodes.

### Principled Metrics
*   **Base Unit:** 80px.
*   **Gap:** 16px.
*   **Row Height:** 24px.
*   **Node Sizes:**
    *   Single: 80px
    *   Double: 176px
    *   Triple: 272px
*   See **[UI_METRICS.md](../UI_METRICS.md)** for detailed specifications.

## 3. Interaction

*   **Node Creation:**
    *   Double-click in columns to create Input/Output nodes.
    *   Double-click in Main Grid to create standard nodes.
*   **Drag & Drop:** Nodes are constrained to their columns (horizontally) but free vertically.
*   **Space Insertion:** Double-click on cell borders to insert space.

## 4. Visual Style

*   **Wire Layout:** Uses a "2x resolution" A* pathfinding grid. Wires route through "gaps" (odd coordinates) between nodes (even coordinates).
*   **Color Coding:**
    *   **Wires:** Colored based on a hash of their port names.
    *   **Nodes:** Colored left border accent based on `typeId`.
*   **Grid Rendering:** "Architectural Draft" style with dashed lines through gaps.
