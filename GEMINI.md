# Gemini Engineering Handbook

This document records critical engineering decisions, architectural patterns, and known pitfalls. It serves as a guide for maintaining the codebase and avoiding regression of complex behaviors.

## 1. Multi-Threaded Architecture & Build System

### Worker Isolation & Circular Dependencies
*   **The Pitfall:** Importing UI components (e.g., `LitElement` editors) directly into node definition files (`nodes.ts`) causes "Circular Import" errors in the Vite build. This happens because the Worker bundle (Compiler/Executor) tries to resolve DOM-dependent code.
*   **The Solution:** Strict separation of Logic vs. UI.
    *   `nodes.ts`: Pure logic, shared with workers.
    *   `ui-registration.ts`: Registers UI components (Editors/Renderers) to node definitions.
    *   **Rule:** Only import `ui-registration.ts` from `controllers.ts` (Main Thread). Never import it from worker entry points.

### Serialization & Proxy Objects
*   **The Pitfall:** Sending `AppState` objects directly to workers via `postMessage` fails with `DataCloneError` or silent corruption. This is because MobX uses **Proxies**, which are not cloneable or serializable by the structured clone algorithm.
*   **The Solution:** Sanitize all data crossing the boundary.
    *   Use `JSON.parse(JSON.stringify(toJS(data)))` to strip Proxies and ensure a clean plain Object structure (POJO) before messaging.

### AudioContext State Mirroring
*   **The Pitfall:** `AudioContext.state` is unreliable inside workers or when queried inconsistently across threads. Browsers auto-suspend contexts.
*   **The Solution:** Do not trust the worker's view of time or state.
    *   Mirror the `AudioContext.state` (`running` vs `suspended`) from the Main Thread to the Worker via explicit `UPDATE_AUDIO_STATE` messages.
    *   Disable auto-resume logic in the audio loop to prevent "warning loops". Resume only on explicit user interaction (click/touch).

## 2. Node System Design

### "Hero Node" Pattern (High-Frequency UI)
*   **The Challenge:** Visualizing high-frequency audio data (FFT, Oscilloscope) via standard graph edges clogs the main thread and the reactivity system.
*   **The Solution:** Use a **Side-Channel**.
    *   Node (`execute`): Writes heavy data to a `ui` output buffer, separate from standard `outputs`.
    *   UI (`Renderer`): Polls `runtimeManager.uiStates.get(nodeId)` directly via `requestAnimationFrame`.
    *   **Benefit:** Bypasses React/MobX overhead for 60fps visualizations.

### Configuration Separation (UI vs. Runtime)
*   **The Pattern:** Distinguish between how a node is *configured* in the Inspector and how it *runs*.
    *   `TUIConfig`: The source of truth (Inspector state). Can contain "Virtual Inputs" (`values`) for unconnected ports.
    *   `TCompiledConfig`: The processed config passed to `execute`. Contains resolved values.
    *   **Rule:** Always use `<TUIConfig, TCompiledConfig>` generics in `defineNode` to enforce this boundary.

### Array Auto-Flattening
*   **The Behavior:** To support polyphony without complicating every node's logic, the `GraphExecutor` employs a heuristic:
    *   If a port expects an `Array` but receives a Scalar, it wraps it.
    *   If a port expects a Scalar but receives an `Array` (stream), it iterates/flattens based on the `autoBroadcast` setting.
    *   **Pitfall:** `core.pack` must strictly return Arrays for vector types (`float4`) to prevent the broadcast system from treating it as a generic Record.

## 3. The "Solid" Graph (Interaction Physics)

### Recursive Movement & Pushing
*   **The Logic:** The graph is physical.
    *   Moving a **Parent/Region** -> Moves all **Children**.
    *   Moving a Node -> **Pushes** overlapping nodes/regions ("Make Space").
*   **Pitfall:** Simple collision checks fail for Complex Regions.
*   **Critical Detail:** Collision logic must recurse. If you push a Region, you must push the Region *and* all its contents.

### Collapsed Region "Singularity"
*   **The Logic:** A collapsed region acts as a single, solid 80x80 (or similarly sized) block.
*   **The Pitfall:** Checking `node.config.visibility` is insufficient because visibility can be set to `'auto'`.
*   **The Solution:** Injected `MetricsProvider`.
    *   The `AppController` (Logic) must ask the `LocalController` (UI Metrics) "Is this region *effectively* collapsed?"
    *   `isCollapsed = (visibility === 'hide') || (visibility === 'auto' && !globalExpanded)`

### Grid Constraints
*   **Rule:** Regions cannot have negative size.
*   **Rule:** Regions cannot be resized to overlap other top-level nodes (unless they are nested).
*   **Rule:** Drag interactions must use **Atomic Undo**. A "Resize" that triggers 50 updates must result in 1 Undo step.

## 4. UI/UX Engineering Pitfalls

### The "Dangling Textbox" (Focus Management)
*   **The Pitfall:** Making a container (like the Grid) `focusable` (`tabIndex="-1"`) allows it to catch keyboard events, but browsers add a default focus ring (blue outline). Users mistake this for a broken or "dangling" text input.
*   **The Solution:** Always add `outline: none` to focusable interactive containers in CSS.

### Global Hotkeys
*   **The Pitfall:** Attaching global listeners (e.g., `window.addEventListener('keydown', ...)`) inside a component's `connectedCallback`.
*   **Reflex Check:** If the component remounts (React/Lit), you get duplicate listeners.
*   **The Solution:**
    1.  Strict usage of `disconnectedCallback` to remove listeners.
    2.  Or, better: centralized Input Manager that dispatches commands, rather than scattered listeners.

### "Virtual Inputs" Preservation
*   **The Pitfall:** When updating a node's config (e.g., changing a dropdown), you might overwrite the `values` object (which holds the values for unconnected input ports).
*   **The Solution:** `GraphExecutor.setNodeConfig` must perform a **Shallow Merge** of top-level keys. Never replace the entire config object with a partial update from the UI.
