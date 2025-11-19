# Graph Editor Implementation Plan

This document outlines the implementation plan for the graph editor UI.

## Phase 1: Basic Grid and Node Rendering

1.  **Grid Component:**
    *   Create a `<graph-grid>` component.
    *   It will be responsible for rendering the grid lines and cells.
    *   It will receive the `AppController` instance as a property.
    *   It will use `mobx`'s `autorun` to react to changes in the `AppController`'s state.

2.  **Node Component:**
    *   Create a `<graph-node>` component.
    *   It will render a single node.
    *   It will receive a `GridNode` object as a property.
    *   It will display the node's `typeId`.

3.  **Connecting Grid and Nodes:**
    *   The `<graph-grid>` component will iterate over the `controller.observableState.graph.nodes` and render a `<graph-node>` for each.
    *   The position of the `<graph-node>` will be determined by its `x` and `y` properties, which will be translated to CSS grid properties.

## Phase 2: Interaction - Creating and Moving Nodes

1.  **Node Creation:**
    *   In `<graph-grid>`, add a double-click handler to empty cells.
    *   The handler will call `controller.createNode()` with the cell's coordinates.

2.  **Node Dragging:**
    *   Implement drag-and-drop functionality for `<graph-node>` elements.
    *   Use the `PointerDragOp` utility for handling pointer events.
    *   On drag start, record the initial node position.
    *   On drag move, update the node's position visually.
    *   On drag end, call `controller.moveNodes()` to update the state.

## Phase 3: Connections

1.  **Connection Rendering:**
    *   Create a `<graph-connection>` component.
    *   It will render a single connection as an SVG path.
    *   It will receive a `Connection` object and the positions of the connected nodes as properties.
    *   The `<graph-grid>` will render all connections.

2.  **Connection Creation:**
    *   Implement a mechanism for creating connections between nodes. This could involve clicking on output/input ports of nodes.

## Phase 4: Inspector UI

1.  **Inspector Component:**
    *   Create an `<inspector-popup>` component.
    *   It will display the properties of the selected node.
    *   It will allow editing the node's `typeId` and other configuration.

2.  **Selection Management:**
    *   Implement a selection model in the `AppController` to track the currently selected node(s).
    *   The `<inspector-popup>` will react to changes in the selection.

## Phase 5: Advanced Features

1.  **Multi-select:**
    *   Allow selecting multiple nodes and dragging them as a group.

2.  **Cell Border Interaction:**
    *   Implement double-click on cell borders to insert space.

3.  **Advanced Connection Routing:**
    *   Implement the PCB-style connection routing algorithm.
