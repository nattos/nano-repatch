import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { DiagnosticSeverity } from './ir-types';

describe('Diagnostics & Error Reporting', () => {
  it('should report warning for unresolved identifier', () => {
    const src = `
            unknown_var;
        `;
    const ir = compileToIR(src, {});
    expect(ir.diagnostics).toBeDefined();
    // We expect a warning for unresolved identifier
    const warning = ir.diagnostics?.find(d => d.message.includes('Unresolved identifier') && d.severity === DiagnosticSeverity.Warning);
    expect(warning).toBeDefined();
    // Check location (Line 2)
    expect(warning?.range?.startLineNumber).toBe(2);
  });

  it('should report TS parser errors', () => {
    const src = `
            let x = ; // Syntax Error
        `;
    const ir = compileToIR(src, {});
    expect(ir.diagnostics).toBeDefined();
    const error = ir.diagnostics?.find(d => d.source === 'ts-parser');
    expect(error).toBeDefined();
    expect(error?.severity).toBe(DiagnosticSeverity.Error);
  });
  it('should verify unsupported syntax (Class/Method)', () => {
    const src = `
        class Foo {
            bar() {}
        }
    `;
    const ir = compileToIR(src, {});
    const warning = ir.diagnostics?.find(d => d.message.includes('Unsupported syntax'));
    expect(warning).toBeDefined();
  });

  it('should error on deep recursion (Stack Overflow Protection)', () => {
    const src = `
        function recurse(n: number) {
            return recurse(n + 1);
        }
        recurse(0);
    `;
    const ir = compileToIR(src, {}); // Should not crash
    // We want a controlled error, not a raw stack overflow exception
    const error = ir.diagnostics?.find(d => d.message.includes('Recursion depth exceeded'));
    expect(error).toBeDefined();
  });
});
