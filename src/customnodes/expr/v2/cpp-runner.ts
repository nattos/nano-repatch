import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Diagnostic, DiagnosticSeverity } from './ir-types';

const TMP_DIR = path.resolve(__dirname, '../../../../tmp');

export interface CppExecutionResult {
  success: boolean;
  output?: any;
  diagnostics: Diagnostic[];
}

export function runCppWithDiagnostics(cppCode: string, input: any): CppExecutionResult {
  const filename = `runner_test_${Date.now()}.cpp`;
  const cppPath = path.join(TMP_DIR, filename);
  const exePath = path.join(TMP_DIR, filename.replace('.cpp', '.out'));
  const diagnostics: Diagnostic[] = [];

  // Ensure tmp dir exists
  if (!fs.existsSync(TMP_DIR)) {
    try { fs.mkdirSync(TMP_DIR); } catch { }
  }
  // Write code
  fs.writeFileSync(cppPath, cppCode);

  try {
    // Compile
    execSync(`clang++ -std=c++17 "${cppPath}" -o "${exePath}"`, { stdio: 'pipe' });
  } catch (e: any) {
    // Compilation failed - Parse stderr
    const stderr = e.stderr ? e.stderr.toString() : e.message;

    // Clang output format: "file:line:col: error: message"
    // Regex: /^(.*):(\d+):(\d+): (error|warning): (.*)$/
    const lines = stderr.split('\n');
    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(\d+): (error|warning|note): (.*)$/);
      if (match) {
        // match[1] file, match[2] line, match[3] col, match[4] severity, match[5] message
        const severity = match[4] === 'error' ? DiagnosticSeverity.Error :
          match[4] === 'warning' ? DiagnosticSeverity.Warning :
            DiagnosticSeverity.Information;

        diagnostics.push({
          message: match[5],
          severity,
          source: 'clang',
          file: match[1],
          range: {
            startLineNumber: parseInt(match[2]),
            startColumn: parseInt(match[3]),
            endLineNumber: parseInt(match[2]),
            endColumn: parseInt(match[3])
          }
        });
      } else if (line.trim().length > 0) {
        // Unparsed lines (context) as info? Or append to previous?
        // For now, if we have active diagnostics, append to last message?
        // Or add as separate Info.
        // Let's add unparsed lines as "Compiler Output"
        // diagnostics.push({ message: line, severity: DiagnosticSeverity.Information, source: 'clang' });
      }
    }

    // If no structured diagnostics parsed, add full raw output
    if (diagnostics.length === 0) {
      diagnostics.push({
        message: stderr,
        severity: DiagnosticSeverity.Error,
        source: 'clang'
      });
    }

    return { success: false, diagnostics };
  }

  // Execution
  try {
    const inputStr = JSON.stringify({ inputs: input });
    const res = execSync(`"${exePath}"`, { input: inputStr, encoding: 'utf-8' });
    const json = JSON.parse(res);
    return { success: true, output: json.outputs, diagnostics: [] };
  } catch (e: any) {
    diagnostics.push({
      message: `Execution failed: ${e.message}`,
      severity: DiagnosticSeverity.Error,
      source: 'runtime'
    });
    return { success: false, diagnostics };
  }
}
