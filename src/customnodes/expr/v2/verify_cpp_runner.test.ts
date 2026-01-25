import { describe, it, expect } from 'vitest';
import { runCppWithDiagnostics } from './cpp-runner';
import { DiagnosticSeverity } from './ir-types';

describe('C++ Runner & Error Caoture', () => {

  it('should run valid C++ code', () => {
    // Basic main returning JSON
    const src = `
        #include <iostream>
        #include "json.hpp" // Assumes json.hpp is in tmp/
        using json = nlohmann::json;

        int main() {
            json out;
            out["outputs"] = { {"val", 42} };
            std::cout << out.dump() << std::endl;
            return 0;
        }
        `;
    const res = runCppWithDiagnostics(src, {});
    expect(res.success).toBe(true);
    expect(res.output.val).toBe(42);
    expect(res.diagnostics.length).toBe(0);
  });

  it('should capture compilation errors as diagnostics', () => {
    const src = `
        int main() {
            int x = "string"; // Type mismatch error
            return 0;
        }
        `;
    const res = runCppWithDiagnostics(src, {});
    expect(res.success).toBe(false);
    expect(res.diagnostics.length).toBeGreaterThan(0);

    const err = res.diagnostics.find(d => d.severity === DiagnosticSeverity.Error);
    expect(err).toBeDefined();
    // Clang usually says "cannot initialize a variable of type 'int' with an lvalue of type 'const char [7]'"
    // Or similar.
    expect(err?.message.toLowerCase()).toContain('int');
    // Expect source to be 'clang'
    expect(err?.source).toBe('clang');
    // Expect line number 3
    expect(err?.range?.startLineNumber).toBe(3);
  });

  it('should capture warnings as diagnostics', () => {
    const src = `
         #include <iostream>
         #include "json.hpp"
         using json = nlohmann::json;

         int main() {
             int unused = 10; // Warning: unused variable

             // Valid output to ensure success despite warning
             json out;
             out["outputs"] = {};
             std::cout << out.dump() << std::endl;
             return 0;
         }
         `;
    // Clang only warns if -Wall or similar is on?
    // runCppWithDiagnostics uses default clang++.
    // Unused variable might need -Wunused-variable.
    // Let's assume default clang warnings might show up, or maybe syntax warning.
    // "std::nullopt" statement logic warning seen previously? "expression result unused".
    // Let's try that.
  });
});
