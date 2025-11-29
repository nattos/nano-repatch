# Expression Node

The Expression node allows you to write simple mathematical expressions to process data.

## Logic

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `logic.expression` | Expression | Evaluates a math expression. | (Dynamic) | `result` (Any) |

## Usage

Enter a mathematical expression in the configuration.
- Variables used in the expression (e.g., `a + b`) will automatically create input ports on the node.
- Supports common math functions (sin, cos, max, etc.).
