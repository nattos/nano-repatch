# Resolume API Probe: Plan & Investigation Notes

This document outlines the plan and findings from building a utility to probe a live Resolume Arena server. The goal was to understand the nuances of its API to build a high-fidelity mock server for development and testing.

## Final Findings

After extensive probing, we have successfully reverse-engineered the core WebSocket API. The REST API proved to be unreliable and mostly non-functional, with the exception of the `/api/product` endpoint. The WebSocket is the primary means of both observing and controlling the Resolume composition.

### WebSocket Connection

-   **Endpoint:** The WebSocket server is located at `ws://<ip>:<port>/api/v1`.

### Initial State

-   Upon successful connection, the server sends a large JSON message containing the entire state of the composition, including all decks, layers, groups, clips, and their parameters.
-   The root of this message does not have a single "composition" key, but instead has top-level keys like `decks`, `layers`, `layergroups`, `columns`, `crossfader`, etc.
-   The full initial state has been captured in `resolume-ws-initial-state.json`.

### Controlling Resolume via WebSocket

Control is achieved by sending JSON messages with a specific structure.

**1. Subscribing to Parameter Updates**

To receive live updates for a specific parameter, you must first subscribe to it.

-   **Action:** `subscribe`
-   **Message Format:**
    ```json
    {
      "action": "subscribe",
      "parameter": "/parameter/by-id/<parameter-id>"
    }
    ```
-   **Server Response:** Upon successful subscription, the server replies with a confirmation containing the parameter's current state and its canonical path.
    ```json
    {
      "id": 1763903991101,
      "valuetype": "ParamRange",
      "value": 0.5,
      "path": "/composition/layers/1/video/opacity",
      "type": "parameter_subscribed"
    }
    ```

**2. Setting a Parameter's Value**

This is used for parameters with continuous values, like sliders (`ParamRange`) or text fields (`ParamString`).

-   **Action:** `set`
-   **Message Format:**
    ```json
    {
      "action": "set",
      "parameter": "/composition/layers/1/video/opacity",
      "id": 1763903991101, // Numeric ID also needed
      "value": 0.25
    }
    ```
-   **Important:** The `parameter` field must be the hierarchical, 1-indexed string path that is returned by the `parameter_subscribed` message. It was discovered that also sending the `id` field in addition to `parameter` in the `set` message is required for this action.

**3. Triggering an Event**

This is used for trigger-style parameters (`ParamTrigger`), like connecting a clip or pressing a button.

-   **Action:** `trigger`
-   **Message Format:**
    ```json
    {
      "action": "trigger",
      "parameter": "/composition/layers/1/clips/1/connect",
      "value": true
    }
    ```
-   **Important:** The `value` field must be a boolean (`true` to fire the trigger). The path must be the correct trigger path (e.g., `.../connect`, not `.../selected`).

---
## Detailed Probe Log and Observations

### WebSocket Connection Header (Provided by User)

```
GET ws://192.168.125.16:8080/api/v1 HTTP/1.1
Host: 192.168.125.16:8080
Connection: Upgrade
Pragma: no-cache
Cache-Control: no-cache
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36
Upgrade: websocket
Origin: http://192.168.125.16:8080
Sec-WebSocket-Version: 13
Accept-Encoding: gzip, deflate
Accept-Language: ja-JP,ja;q=0.9,en-CA;q=0.8,en;q=0.7,en-US;q=0.6
Sec-WebSocket-Key: C4gpuZcKgejagne3w72dsw==
Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits
```
**Observation:** Confirmed `/api/v1` as the correct WebSocket endpoint.

### Initial State Message

The first message received on WebSocket connection contains a comprehensive dump of the Resolume composition state. This supersedes the need for REST calls to initially fetch composition data.

**Excerpt (for `layers[0].video.opacity` parameter):**
```json
"opacity": {
  "id": 1763903991101,
  "valuetype": "ParamRange",
  "min": 0,
  "max": 1,
  "value": 0.5
}
```
**Observation:** The initial state message is indeed a full composition, not just `effects_update`. The previous console output was misleading due to truncation. Parameter IDs are numeric.

### REST API Failures

Multiple attempts to use REST endpoints (`/api/v1/composition`, `/api/v1/params/{id}`) consistently resulted in `404 Not Found` errors.

**Example Error for REST PUT (parameter update):**
```
Attempting to update parameter ID 1763903991101 to 0.25 via REST...
fetching http://192.168.125.16:8080/api/v1/params/1763903991101
[ResolumeApiClient] Error in request: Error: API request failed: 404 Not Found
❌ Failed to update parameter via REST: Error: API request failed: 404 Not Found
```
**Observation:** The REST API (beyond `/api/product`) is largely non-functional for this Resolume instance/version.

### WebSocket Control - Iterative Discovery

**Attempt 1: Missing "action" field**
-   **Sent:** `{ "id": "<paramId>", "value": <newValue> }` (and variations)
-   **Received:**
    ```json
    {
      "id": null,
      "error": "error reading field \"action\": mandatory field doesn't exist"
    }
    ```
-   **Learning:** An `"action"` field is mandatory in control messages.

**Attempt 2: Incorrect "action" enum value**
-   **Sent:** `{ "action": "set_param_value", "id": "<paramId>", "value": <newValue> }` (and `action: "update"`, `action: "/params"`)
-   **Received:**
    ```json
    {
      "id": null,
      "error": "error reading field \"action\": Invalid enum value"
    }
    ```
-   **Learning:** Common action names like `"set_param_value"`, `"update"`, `"/params"` are not valid.

**Attempt 3: `action: "set"` and incorrect "parameter" field type**
-   **Sent:** `{ "action": "set", "parameter": { "id": "<paramId>", ... }, "value": <newValue> }`
-   **Received:**
    ```json
    {
      "path": "<unknown>",
      "error": "error reading field \"parameter\": value is not std::string"
    }
    ```
-   **Learning:** `action: "set"` is a valid action. The `"parameter"` field must be a string, not a JSON object.

**Attempt 4: `action: "set"` and `parameter: "<paramId>"` (ID as string)**
-   **Sent:** `{ "action": "set", "parameter": "1763903991101", "value": <newValue> }`
-   **Received:**
    ```json
    {
      "path": "1763903991101",
      "error": "Invalid parameter path"
    }
    ```
-   **Learning:** The `parameter` field expects a path, not just the string representation of the ID.

**Attempt 5: `action: "set"` and `parameter: "/layers/<layerId>/video/opacity"` (hierarchical path)**
-   **Sent:** `{ "action": "set", "parameter": "/layers/1762589641798/video/opacity", "value": <newValue> }`
-   **Received:** `"Invalid parameter path"`
-   **Learning:** This hierarchical path, while reflecting the JSON structure, was still not the correct format.

**Attempt 6: `action: "set"` and `parameter: "/composition/layers/<layerId>/video/opacity/<paramId>"` (more explicit path)**
-   **Sent:** `{ "action": "set", "parameter": "/composition/layers/1762589641798/video/opacity/1763903991101", "value": <newValue> }`
-   **Received:** `"Invalid parameter path"`
-   **Learning:** Even this highly explicit path did not work.

**Attempt 7: `action: "set"` and `parameter: "/params/<paramId>"` (REST-like path)**
-   **Sent:** `{ "action": "set", "parameter": "/params/1763903991101", "value": <newValue> }`
-   **Received:** `"Invalid parameter path"`
-   **Learning:** This also did not work.

**Breakthrough: Eavesdropping and `parameter_subscribed` message**
-   By observing the browser's developer tools, we discovered the `parameter_subscribed` message, which explicitly returned the canonical path.
-   **Received (for opacity subscription):**
    ```json
    {
      "id": 1763903991101,
      "valuetype": "ParamRange",
      "min": 0,
      "max": 1,
      "value": 0.5,
      "path": "/composition/layers/1/video/opacity",
      "type": "parameter_subscribed"
    }
    ```
-   **Learning:** The correct path format for `parameter` is indeed hierarchical and 1-indexed for layer/clip/etc. paths. The path is `/composition/layers/1/video/opacity`.

**Attempt 8: `action: "set"` with correct path, but missing `id` (for `ParamRange` opacity)**
-   **Sent:** `{ "action": "set", "parameter": "/composition/layers/1/video/opacity", "value": 0.25 }`
-   **Received:** Still `"Invalid parameter path"`.
-   **Learning:** This implied that `id` might also be needed in the `set` message.

**Attempt 9: `action: "set"` with correct path AND `id` (for `ParamRange` opacity)**
-   **Sent:**
    ```json
    {
      "action": "set",
      "parameter": "/composition/layers/1/video/opacity",
      "id": 1763903991101,
      "value": 0.25
    }
    ```
-   **Received:** No error message received, and the parameter *successfully changed in Resolume UI*.
-   **Learning:** This is the correct message format for setting `ParamRange` values.

**Attempt 10: `action: "set"` for a `ParamTrigger` (e.g., clip `connect`)**
-   **Subscribed Path (for `connect`):** From `resolume-ws-initial-state.json`, we found `layers[0].clips[0].connected` has ID `1763903990340` and path `/composition/layers/1/clips/1/connect`.
-   **Sent (set `connect` to `true`):** `{ "action": "set", "parameter": "/composition/layers/1/clips/1/connect", "value": true }`
-   **Received:** `"This field is read-only"`
-   **Learning:** `action: "set"` is the wrong action for a `ParamTrigger`. The field is read-only when accessed via `set`.

**Attempt 11: `action: "trigger"` for `ParamTrigger` (e.g., clip `connect`)**
-   **Sent:**
    ```json
    {
      "action": "trigger",
      "parameter": "/composition/layers/1/clips/1/connect",
      "value": true
    }
    ```
-   **Received:** No error message received, and the *clip successfully triggered in Resolume UI*.
-   **Learning:** This is the correct message format for triggering `ParamTrigger` events.

### Timing Notes

-   We did not explicitly measure latency for parameter updates. However, the iteration speed of the probe (2-second delays between attempts) shows that responses from the server (both success and error) are near-instantaneous (within milliseconds of sending the message).
-   There was no observed continuous stream of parameter updates (e.g., when manually dragging a fader in the web UI) unless specifically subscribed to, which reinforces the explicit subscription model.

### Quirks/Unexpected Results

-   **REST API Unreliability:** The vast majority of the documented REST API endpoints (except `/api/product`) returned `404 Not Found`, forcing a complete pivot to WebSocket for control.
-   **WebSocket Endpoint Ambiguity:** It took several attempts to locate the correct WebSocket endpoint at `/api/v1`, differing from common `/ws` conventions.
-   **Strict Message Format:** The server is very particular about the exact JSON message format, requiring specific `action` enum values and the precise string format for `parameter` paths.
-   **1-Indexed Paths:** Hierarchical paths for parameters (e.g., `/composition/layers/1/video/opacity`) are 1-indexed, which can be a common source of off-by-one errors compared to 0-indexed programming arrays.
-   **"Read-Only" Parameters:** Some parameters (like `selected` status) are read-only and cannot be directly set, even with correct action/path. These are status indicators.
-   **Separate Actions for Set vs. Trigger:** `ParamRange` uses `action: "set"`, while `ParamTrigger` uses `action: "trigger"`. Both still require a `value` field.
---
## Original Investigation Plan (Archive)

### Scenario A: Full Composition Dump (Superseded by WebSocket)

-   **Goal:** Get a complete snapshot of a Resolume composition.
-   **Result:** REST endpoints for composition, layers, etc. returned `404 Not Found`. The full state is sent on WebSocket connect.

### Scenario B: Parameter Update & WebSocket Feedback (Successful)

-   **Goal:** Understand the round-trip behavior of updating a parameter.
-   **Result:** REST `PUT` requests failed. Control must be done via WebSocket. Successfully found correct WebSocket message format for setting `ParamRange` values.

### Scenario C: Clip Transport & Playhead Monitoring

-   **Goal:** Observe how clip transport controls and playback position are communicated.
-   **Next Step:** This can now be investigated by subscribing to the `position` parameter within a clip's `transport` object.

### Scenario D: Event & Trigger Parameters (Successful)

-   **Goal:** Understand how "trigger" or "event" type parameters behave.
-   **Result:** Succeeded. The correct format is `action: "trigger"`.
