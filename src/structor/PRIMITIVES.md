# Primitive Nodes

This document lists all available primitive nodes in the Structor system.

## Math (Constants)

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `math.pi` | Pi | Returns the value of Pi. | - | `result` (Number) |
| `math.e` | E | Returns the value of Euler's number. | - | `result` (Number) |

## Math (Binary)

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `math.add` | Add | Adds `a` and `b`. | `a` (Number), `b` (Number) | `result` (Number) |
| `math.subtract` | Subtract | Subtracts `b` from `a`. | `a` (Number), `b` (Number) | `result` (Number) |
| `math.multiply` | Multiply | Multiplies `a` and `b`. | `a` (Number), `b` (Number) | `result` (Number) |
| `math.divide` | Divide | Divides `a` by `b`. | `a` (Number), `b` (Number) | `result` (Number) |
| `math.pow` | Power | Raises `a` to the power of `b`. | `a` (Number), `b` (Number) | `result` (Number) |
| `math.min` | Min | Returns the smaller of `a` and `b`. | `a` (Number), `b` (Number) | `result` (Number) |
| `math.max` | Max | Returns the larger of `a` and `b`. | `a` (Number), `b` (Number) | `result` (Number) |
| `math.clamp` | Clamp | Clamps a value between a minimum and maximum. | `value` (Number), `min` (Number), `max` (Number) | `0` (Number) |
| `math.fmod` | FMod | Floating point modulo operation. | `dividend` (Number), `divisor` (Number) | `div` (Number), `mod` (Number) |

## Math (Utility)

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `math.lerp` | Lerp | Linear interpolation between `a` and `b` by `t`. | `a` (Number), `b` (Number), `t` (Number) | `result` (Number) |
| `math.map` | Map | Maps `value` from [`inMin`, `inMax`] to [`outMin`, `outMax`]. | `value`, `inMin`, `inMax`, `outMin`, `outMax` | `result` (Number) |

## Math (Unary)

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `math.abs` | Abs | Returns the absolute value of `a`. | `a` (Number) | `result` (Number) |
| `math.negate` | Negate | Negates `a`. | `a` (Number) | `result` (Number) |
| `math.ceil` | Ceil | Rounds `a` up to the nearest integer. | `a` (Number) | `result` (Number) |
| `math.floor` | Floor | Rounds `a` down to the nearest integer. | `a` (Number) | `result` (Number) |
| `math.round` | Round | Rounds `a` to the nearest integer. | `a` (Number) | `result` (Number) |
| `math.sin` | Sin | Returns the sine of `a` (radians). | `a` (Number) | `result` (Number) |
| `math.cos` | Cos | Returns the cosine of `a` (radians). | `a` (Number) | `result` (Number) |
| `math.tan` | Tan | Returns the tangent of `a` (radians). | `a` (Number) | `result` (Number) |
| `math.sqrt` | Sqrt | Returns the square root of `a`. | `a` (Number) | `result` (Number) |

## Logic (Binary)

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `logic.and` | AND | Logical AND (1 if both non-zero, else 0). | `a` (Number), `b` (Number) | `result` (Number) |
| `logic.or` | OR | Logical OR (1 if either non-zero, else 0). | `a` (Number), `b` (Number) | `result` (Number) |
| `logic.xor` | XOR | Logical XOR (1 if different truthiness, else 0). | `a` (Number), `b` (Number) | `result` (Number) |
| `logic.equals` | Equals | Returns 1 if `a` equals `b`, else 0. | `a` (Number), `b` (Number) | `result` (Number) |
| `logic.greater_than` | Greater Than | Returns 1 if `a` > `b`, else 0. | `a` (Number), `b` (Number) | `result` (Number) |
| `logic.less_than` | Less Than | Returns 1 if `a` < `b`, else 0. | `a` (Number), `b` (Number) | `result` (Number) |

## Logic (Unary)

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `logic.not` | NOT | Logical NOT (1 if zero, 0 if non-zero). | `a` (Number) | `result` (Number) |

## Utility

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `util.hub` | Hub | Passes input to output. | `value` (Any) | `value` (Any) |

## Data

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `data.literal` | Literal | Outputs a constant value. | - | `0` (Any) |
| `data.float` | Float | Float value with slider. | `value` (Number) | `value` (Number) |

## Functional

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `functional.apply` | Apply Functor | Applies a functor to an input value. | `functor` (Functor), `value` (Any) | `0` (Any) |

## IO

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `io.input` | Input | Graph input node. | - | `0` (Any) |
| `io.output` | Output | Graph output node. | `0` (Any) | - |

## Core

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `core.subgraph` | Subgraph | Executes a nested subgraph. | (Dynamic) | (Dynamic) |
