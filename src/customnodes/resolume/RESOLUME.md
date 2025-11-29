# Resolume Nodes

This document lists available nodes for integrating with Resolume Arena.

## IO

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `io.resolume.input` | Resolume Parameter Input | Reads a parameter value from Resolume. | - | `val` (Any) |
| `io.resolume.output` | Resolume Parameter Output | Writes a value to a Resolume parameter. | `val` (Any) | - |

## Usage

Resolume nodes are used to interact with a running instance of Resolume Arena via WebSocket.
- **Input Node**: Select a parameter in Resolume to monitor its value.
- **Output Node**: Connect a value to control a parameter in Resolume.
