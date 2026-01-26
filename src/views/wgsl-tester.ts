import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { compileToIR } from '../customnodes/expr/v2/compiler';
import { generateWGSL } from '../customnodes/expr/v2/codegen-wgsl';
import { DataTypeKind, PrimitiveType, DataType } from '../customnodes/expr/v2/ir-types';

const F32_SIZE = 4;

@customElement('wgsl-tester')
export class WGSLTester extends MobxLitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
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
  code = `// Ex 1: Basic Math
return x + 10;`;

  @state()
  output = '';

  @state()
  wgslCode = '';

  // Helpers for preset loading
  setPreset(name: string) {
    if (name === 'math') this.code = 'return x * 2 + 1;';
    if (name === 'loop') this.code = `let sum = 0;
for(let i=0; i<10; i++) {
    sum = sum + i;
}
return sum;`;
    if (name === 'struct') this.code = `const v = { x: 1, y: 2 };
return v.x + v.y + x;`;
    if (name === 'mandel') this.code = `
        let z_re = 0.0;
        let z_im = 0.0;
        let c_re = 0.353;
        let c_im = 0.288;
        let i = 0;
        for (let k = 0; k < 100; k++) {
            if (z_re * z_re + z_im * z_im > 4.0) {
               break;
            }
            let next_re = z_re * z_re - z_im * z_im + c_re;
            let next_im = 2.0 * z_re * z_im + c_im;
            z_re = next_re;
            z_im = next_im;
            i = i + 1;
        }
        return i;
    `;
  }

  async run() {
    this.output = 'Compiling...';
    try {
      // Guess inputs based on code check?
      // Or just provide standard Inputs.
      // Let's providing "x" (number) as standard input.
      const inputs: Record<string, DataType> = {
        x: { kind: DataTypeKind.Primitive, name: 'number' } as PrimitiveType
      };

      const ir = compileToIR(this.code, inputs);
      const wgsl = generateWGSL(ir, {
        inputs: inputs,
        outputType: { kind: DataTypeKind.Primitive, name: 'number' } as any
      });
      this.wgslCode = wgsl;

      this.output += '\nWGSL Generated.\nRunning on GPU...';

      if (!navigator.gpu) {
        this.output += '\nWebGPU not supported in this browser.';
        return;
      }

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        this.output += '\nNo adapter found.';
        return;
      }
      const device = await adapter.requestDevice();

      const shaderModule = device.createShaderModule({ code: wgsl });

      // Input Buffer (x = 10.0)
      const inputData = new Float32Array([10.0]); // x
      const inputBuffer = device.createBuffer({
        size: inputData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(inputBuffer, 0, inputData);

      // Output Buffer (result = f32)
      const outputBufferSize = 4;
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
      const result = new Float32Array(arrayBuffer)[0];

      this.output += `\nSuccess!\nResult: ${result}`;
      readBuffer.unmap();

    } catch (e: any) {
      this.output += `\nError: ${e.message}\n${e.stack}`;
    }
  }

  render() {
    return html`
      <div class="toolbar">
        <button @click=${() => this.setPreset('math')}>Math</button>
        <button @click=${() => this.setPreset('loop')}>Loop</button>
        <button @click=${() => this.setPreset('struct')}>Struct</button>
        <button @click=${() => this.setPreset('mandel')}>Mandelbrot</button>
        <div style="flex:1"></div>
        <button @click=${this.run}>RUN WGSL</button>
      </div>
      <div style="display:flex; flex:1; gap:10px; min-height:0;">
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
    `;
  }
}
