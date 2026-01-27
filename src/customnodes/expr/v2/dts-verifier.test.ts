import { describe, it, expect } from 'vitest';
import { generateDTS } from './generate-dts';
import * as ts from 'typescript';

describe('StdLib DTS Generation', () => {
  it('should generate valid TypeScript definitions', () => {
    const dts = generateDTS();
    console.log(dts); // For inspection

    expect(dts).toContain('declare const Math');
    expect(dts).toContain('interface Array<T>');
    expect(dts).toContain('sin(x: number): number');

    // Parse using TS
    const sourceFile = ts.createSourceFile('stdlib.d.ts', dts, ts.ScriptTarget.Latest);

    // Check for parse errors
    // (ts.createSourceFile doesn't throw, but we can check diagnostics if we create a program,
    //  or simpler: ensure no "Unknown" syntax nodes or just Basic sanity)

    expect(sourceFile.statements.length).toBeGreaterThan(0);

    // Simple check: Declaration kinds
    const decls = sourceFile.statements.map(s => s.kind);
    // Should have Variables (Math), Interfaces (Array), etc.
    expect(decls).toContain(ts.SyntaxKind.VariableStatement); // Math
    expect(decls).toContain(ts.SyntaxKind.InterfaceDeclaration); // Array
  });

  it('should be type-checkable', () => {
    const dts = generateDTS();
    // Create a dummy program with this file
    const compilerOptions: ts.CompilerOptions = {
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.CommonJS
    };

    const host = ts.createCompilerHost(compilerOptions);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (fileName === 'stdlib.d.ts') {
        return ts.createSourceFile(fileName, dts, languageVersion);
      }
      return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    };

    const program = ts.createProgram(['stdlib.d.ts'], compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    // Filter out some lib defaults clashes if any
    const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
      console.error(errors.map(e => e.messageText).join('\n'));
    }
    expect(errors.length).toBe(0);
  });
  it('should match expected signatures via AST inspection', () => {
    const dts = generateDTS();
    const sourceFile = ts.createSourceFile('stdlib.d.ts', dts, ts.ScriptTarget.Latest);

    // Helper to find nodes
    const findNode = (nodes: ts.NodeArray<ts.Statement>, kind: ts.SyntaxKind, name?: string) => {
      return nodes.find(n => n.kind === kind && (!name || (n as any).name?.text === name));
    };

    // 1. Verify Array<T> Interface
    const arrayIf = findNode(sourceFile.statements, ts.SyntaxKind.InterfaceDeclaration, 'Array') as ts.InterfaceDeclaration;
    expect(arrayIf).toBeDefined();

    // Check Generics: Array<T>
    expect(arrayIf.typeParameters).toBeDefined();
    expect(arrayIf.typeParameters!.length).toBe(1);
    expect(arrayIf.typeParameters![0].name.text).toBe('T');

    // Check Member: push(...items: T[]): number
    const pushMethod = arrayIf.members.find(m => (m.name as ts.Identifier).text === 'push') as ts.MethodSignature;
    expect(pushMethod).toBeDefined();
    expect(pushMethod.parameters.length).toBe(1);
    expect(pushMethod.parameters[0].dotDotDotToken).toBeDefined(); // Rest param
    // Check param type: T[]
    const paramType = pushMethod.parameters[0].type as ts.ArrayTypeNode;
    expect(paramType.kind).toBe(ts.SyntaxKind.ArrayType);
    expect((paramType.elementType as ts.TypeReferenceNode).typeName.getText(sourceFile)).toBe('T');

    // Check Member: map<U>(callbackfn: ...): U[]
    const mapMethod = arrayIf.members.find(m => (m.name as ts.Identifier).text === 'map') as ts.MethodSignature;
    expect(mapMethod).toBeDefined();
    expect(mapMethod.typeParameters).toBeDefined();
    expect(mapMethod.typeParameters![0].name.text).toBe('U');
    // Return Type: U[]
    const mapRet = mapMethod.type as ts.ArrayTypeNode;
    expect((mapRet.elementType as ts.TypeReferenceNode).typeName.getText(sourceFile)).toBe('U');

    // 2. Verify Math Object
    const mathStmt = sourceFile.statements.find(s =>
      s.kind === ts.SyntaxKind.VariableStatement &&
      ((s as ts.VariableStatement).declarationList.declarations[0].name as ts.Identifier).text === 'Math' &&
      (s as ts.VariableStatement).declarationList.declarations[0].type?.kind === ts.SyntaxKind.TypeLiteral
    ) as ts.VariableStatement;

    expect(mathStmt).toBeDefined();
    const typeLit = mathStmt.declarationList.declarations[0].type as ts.TypeLiteralNode;



    const sinMember = typeLit.members.find(m => (m.name as ts.Identifier).text === 'sin') as ts.MethodSignature;
    expect(sinMember).toBeDefined();
    expect(sinMember.parameters.length).toBe(1);
    expect(sinMember.parameters[0].name.getText(sourceFile)).toBe('x');
    expect(sinMember.parameters[0].type?.kind).toBe(ts.SyntaxKind.NumberKeyword);
    expect(sinMember.type?.kind).toBe(ts.SyntaxKind.NumberKeyword); // Return type

  });

  it('should resolve "undefined" in a noLib environment', () => {
    const dts = generateDTS();
    const testCode = 'let x = undefined;';

    // Create a program with NO default libs
    const compilerOptions: ts.CompilerOptions = {
      noEmit: true,
      noLib: true, // Critical: simulate DSL environment
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.CommonJS
    };

    const host = ts.createCompilerHost(compilerOptions);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (fileName === 'stdlib.d.ts') return ts.createSourceFile(fileName, dts, languageVersion);
      if (fileName === 'test.ts') return ts.createSourceFile(fileName, testCode, languageVersion);
      return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    };

    // Note: In real Monaco we'd add dts as "extra lib". Here we pass it as source file.
    const program = ts.createProgram(['stdlib.d.ts', 'test.ts'], compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    // Check for "Cannot find name 'undefined'" errors
    const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
    const undefinedErrors = errors.filter(e => e.messageText.toString().includes('undefined'));
    if (undefinedErrors.length > 0) {
      console.error(undefinedErrors.map(e => ts.formatDiagnostics([e], {
        getCanonicalFileName: f => f,
        getCurrentDirectory: () => '/',
        getNewLine: () => '\n'
      })).join('\n'));
    }

    expect(undefinedErrors.length).toBe(0);
  });
});
