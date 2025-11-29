# MIDI Nodes

This document lists available nodes for MIDI integration.

## IO

| ID | Name | Description | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| `io.midi.cc` | MIDI CC | Listens for MIDI Control Change messages. | - | `value` (Number) |
| `io.midi.note` | MIDI Note | Listens for MIDI Note On/Off messages. | - | `note` (Number), `velocity` (Number), `gate` (Number) |

## Usage

MIDI nodes allow you to use external MIDI controllers to drive your graph.
- **MIDI CC**: Configure the channel and CC number to listen to. The output is normalized to 0-1.
- **MIDI Note**: Configure the channel and note number. Outputs the note number, velocity (0-1), and gate status.
