import { defineConfig } from 'vite';
import { run } from 'vite-plugin-run';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  root: 'src',
  publicDir: '../assets',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@wasmer/sdk'],
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: '../node_modules/onnxruntime-web/dist/*',
          dest: '.'
        },
      ]
    }),
    run({
      silent: false,
      input: [
        {
          name: 'build-wasm',
          run: [
            'emcc',
            'src/wasm/audio_to_clock.cpp',
            'src/wasm/audio_to_clock_wasm.cpp',
            'src/wasm/audio_utils.cpp',
            'src/wasm/external_clock_controller.cpp',
            'src/wasm/extrapolation.cpp',
            'src/wasm/inference_manager.cpp',
            'src/wasm/stabilizer.cpp',
            '-o', 'src/wasm/audio_to_clock_wasm.js',
            '-s', 'WASM=1',
            '-s', 'MODULARIZE=1',
            '-s', 'EXPORT_ES6=1',
            '-s', 'EXPORT_NAME=createAudioToClockWasm',
            '--bind',
            '-std=c++20',
            '-fexceptions',
            '-s', "EXPORTED_FUNCTIONS=['_malloc','_free']",
            '-s', "EXPORTED_RUNTIME_METHODS=['ccall', 'cwrap', 'HEAPF32']",
            '-gsource-map',
          ],
          pattern: ['**/*.c', '**/*.cpp', '**/*.h', '**/*.hpp'],
        },
      ],
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});