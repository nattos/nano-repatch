# Testing Strategy & Guidelines

The project utilizes two distinct testing frameworks, each serving a specific purpose.

## 1. Frameworks

### Vitest (Unit/Component Tests)
*   **Purpose:** Unit and component-level testing (functions, classes, UI components).
*   **Location:** Co-located with source files in `src/` (e.g., `src/module/my-component.test.ts`).
*   **Execution:** `npm test`.

### Jest (End-to-End/E2E Tests)
*   **Purpose:** High-level end-to-end testing, simulating user interactions via Puppeteer.
*   **Location:** Top-level `test/` directory (e.g., `test/app.test.ts`).
*   **Execution:** `npm run test:e2e`.

## 2. Guidelines

*   **Framework Segregation:** Do not mix Jest syntax (e.g., `jest.setTimeout`) within Vitest tests, and vice-versa.
*   **File Location:** Ensure test files are in the correct directory (`src/` vs `test/`) to be picked up by the correct runner.
*   **Configuration:** Do not configure Vitest to include the `test/` directory.

## 3. E2E Testing Standardization

### Critical Rules
1.  **NO Timeout Changes:** Do NOT change `jest.setTimeout`. Fix the test logic instead.
2.  **NO Port Changes:** Always use port `5173`.
3.  **NO Manual Server Management:** The server is managed globally by `jest-puppeteer.config.js`.
4.  **Programmatic State Management:** Use `window.testing.appController.loadGraph(...)` to reset state. Avoid page reloads.

### Best Practices
*   **Shadow DOM Traversal:** Use `page.evaluate()` or `page.evaluateHandle()` to traverse shadow roots manually. Avoid `>>>`.
*   **Programmatic Node Creation:** Use `window.testing.appController.createNode()` for setup unless testing the creation UI itself.
*   **Debugging:** Use `page.evaluate()` to log `innerHTML` if selectors fail. Check for zombie processes on port 5173.

## 4. Integration Tests

*   **Primitives:** `src/structor/primitives-integration.test.ts` verifies the execution of primitive nodes in a compiled graph.
*   **Subgraphs:** `src/views/subgraph-integration.test.ts` verifies dynamic port generation and virtual inputs.
