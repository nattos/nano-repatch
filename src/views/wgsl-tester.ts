import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { compileToIR } from '../customnodes/expr/v2/compiler';
import { generateWGSL } from '../customnodes/expr/v2/codegen-wgsl';
import { DataTypeKind, PrimitiveType, DataType } from '../customnodes/expr/v2/ir-types';
import { testCases, TestCase } from '../customnodes/expr/v2/backend-test-cases';
import { packData, unpackData } from '../customnodes/expr/v2/wgsl-utils';

const F32_SIZE = 4;

@customElement('wgsl-tester')
export class WGSLTester extends MobxLitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: row;
      width: 100%;
      height: 100%;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: monospace;
      padding: 20px;
      box-sizing: border-box;
      gap: 10px;
    }
    textarea {
      width: 100%;
      height: 300px;
      background: #252526;
      color: #dcdcdc;
      border: 1px solid #3e3e42;
      font-family: inherit;
      padding: 10px;
    }
    button {
      padding: 8px 16px;
      background: #0e639c;
      color: white;
      border: none;
      cursor: pointer;
    }
    button:hover {
      background: #1177bb;
    }
    .toolbar {
      display: flex;
      gap: 10px;
    }
    pre {
      background: #2d2d2d;
      padding: 10px;
      overflow: auto;
      flex: 1;
    }
  `;

  @state()
  currentTest: TestCase | null = null;

  @state()
  code = '';

  @state()
  output = '';

  @state()
  wgslCode = '';

  loadTest(tc: TestCase) {
    this.currentTest = tc;
    this.code = tc.code;
    this.output = '';
    this.wgslCode = '';
  }

  async run() {
    try {
      if (!this.currentTest) {
        // Default "Custom" run?
        // Assume inputs { x: number }
        this.currentTest = {
          name: 'Custom',
          code: this.code,
          inputValues: { x: 10 },
          inputTypes: { x: { kind: DataTypeKind.Primitive, name: 'number' } as PrimitiveType },
          outputType: { kind: DataTypeKind.Primitive, name: 'number' } as PrimitiveType
        };
      }

      this.output = `=== ${this.currentTest.name} ===\nCompiling...`;

      // Use inputs from test case (or defaults)
      const inputs = this.currentTest.inputValues || {};
      let inputTypes = this.currentTest.inputTypes;

      // Infer types if missing
      if (!inputTypes) {
        inputTypes = {};
        for (const k in inputs) {
          if (typeof inputs[k] === 'number') inputTypes[k] = { kind: DataTypeKind.Primitive, name: 'number' } as any;
          else if (Array.isArray(inputs[k])) inputTypes[k] = { kind: DataTypeKind.Array, elementType: { kind: DataTypeKind.Primitive, name: 'number' } as any } as any; // Simple inference fallback
          else if (typeof inputs[k] === 'object') inputTypes[k] = { kind: DataTypeKind.Struct, fields: {} } as any; // Naive
        }
      }

      const ir = compileToIR(this.code, inputTypes);
      // Default output type to number if undefined, unless inferred by codegen?
      // Codegen needs explicit output type struct wrapper.
      // We'll trust testCase.outputType or default to number.
      const outputType = this.currentTest.outputType || { kind: DataTypeKind.Primitive, name: 'number' } as any;

      const wgsl = generateWGSL(ir, {
        inputs: inputTypes,
        outputType: outputType
      });
      this.wgslCode = wgsl;

      this.output += '\nWGSL Generated.\nRunning on GPU...';

      if (!navigator.gpu) {
        this.output += '\nWebGPU not supported in this browser.';
        return 'Error: WebGPU not supported';
      }

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        this.output += '\nNo adapter found.';
        return 'Error: No adapter found';
      }
      const device = await adapter.requestDevice();

      const shaderModule = device.createShaderModule({ code: wgsl });

      // Check for compilation errors
      const compilationInfo = await shaderModule.getCompilationInfo();
      if (compilationInfo.messages.length > 0) {
        let hadError = false;
        for (const msg of compilationInfo.messages) {
          this.output += `\n[${msg.type}] line ${msg.lineNum}:${msg.linePos} - ${msg.message}`;
          if (msg.type === 'error') hadError = true;
        }
        if (hadError) {
          this.output += '\n\nShader Compilation Failed. Aborting.';
          return `Error: Shader Compilation Failed\nLogs:\n${this.output}\n\nCode:\n${this.wgslCode}`;
        }
      }

      // --- Pack Inputs ---
      // Flatten all inputs into single buffer (Input struct)
      const inputFloats: number[] = [];
      // Order must match codegen (Object.keys sorted)
      const sortedKeys = Object.keys(inputTypes).sort();
      for (const k of sortedKeys) {
        inputFloats.push(...packData(inputs[k], inputTypes[k]));
      }

      const inputData = new Float32Array(inputFloats);
      // If empty input? Make at least 4 bytes to avoid validation error on zero-size binding?
      // WGSL struct Input {} is valid? empty struct.
      // If inputData is empty, buffer create might fail if size 0.
      const inputSize = Math.max(inputData.byteLength, 16); // Minimum size
      const inputBuffer = device.createBuffer({
        size: inputSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      if (inputData.byteLength > 0) {
        device.queue.writeBuffer(inputBuffer, 0, inputData);
      }

      // --- Output Buffer ---
      // Allocate generous size (e.g. 64KB) or estimate
      const outputBufferSize = 65536;
      const outputBuffer = device.createBuffer({
        size: outputBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'read-only-storage' }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'storage' }
          }
        ]
      });

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      });

      // Pipeline
      const pipeline = device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: 'main' },
      });

      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: outputBuffer } }
        ]
      });

      const commandEncoder = device.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.dispatchWorkgroups(1);
      passEncoder.end();

      // Readback
      const readBuffer = device.createBuffer({
        size: outputBufferSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
      });
      commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, outputBufferSize);
      device.queue.submit([commandEncoder.finish()]);

      await readBuffer.mapAsync(GPUMapMode.READ);
      const arrayBuffer = readBuffer.getMappedRange();
      const floatView = new Float32Array(arrayBuffer);

      // Unpack Result from Output Struct
      // Output struct is { result: T }
      // So simple unpack of T
      const resValue = unpackData(floatView, outputType);

      this.output += `\nSuccess!\nResult: ${JSON.stringify(resValue, null, 2)}`;

      // Verify against expected?
      if (this.currentTest.expected !== undefined) {
        this.output += `\nExpected: ${JSON.stringify(this.currentTest.expected, null, 2)}`;
      }

      readBuffer.unmap();
      return `Success: ${JSON.stringify(resValue)}`;

    } catch (e: any) {
      this.output += `\nError: ${e.message}\n${e.stack}`;
      return `Error: ${e.message}`;
    }
  }

  async runTestByName(name: string): Promise<string> {
    const tc = testCases.find(t => t.name === name);
    if (!tc) return `Error: Test ${name} not found`;
    this.loadTest(tc);
    return await this.run();
  }

  render() {
    return html`
      <div style="width: 250px; border-right: 1px solid #333; overflow:auto; display:flex; flex-direction:column;">
        <div style="padding:10px; font-weight:bold; background:#252526;">Test Cases</div>
        ${testCases.map(tc => html`
            <div
                style="padding:5px 10px; cursor:pointer; background:${this.currentTest === tc ? '#37373d' : 'transparent'}; text-overflow:ellipsis; white-space:nowrap; overflow:hidden;"
                @click=${() => this.loadTest(tc)}
            >
                ${tc.name}
                ${tc.skipWGSL ? ' (SKIP)' : ''}
            </div>
        `)}
      </div>
      <div style="flex:1; display:flex; flex-direction:column; padding:10px;">
        <div class="toolbar">
           <button @click=${this.run}>RUN WGSL</button>
        </div>
        <div style="display:flex; flex:1; gap:10px; min-height:0; margin-top:10px;">
            <div style="flex:1; display:flex; flex-direction:column;">
                <h3>TypeScript</h3>
                <textarea @input=${(e: any) => this.code = e.target.value} .value=${this.code}></textarea>
                <h3>WGSL Output</h3>
                <pre style="flex:1">${this.wgslCode}</pre>
            </div>
            <div style="flex:1; display:flex; flex-direction:column;">
                <h3>Execution Output</h3>
                <pre>${this.output}</pre>
            </div>
        </div>
      </div>
    `;
  }
}
