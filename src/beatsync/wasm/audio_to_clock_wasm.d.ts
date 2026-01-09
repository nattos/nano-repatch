/**
 * Represents the optional configuration object that can be passed to the
 * Emscripten module factory function.
 */
interface EmscriptenModuleOptions {
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  // You can add other Emscripten runtime properties here if you use them
  // e.g., canvas?: HTMLCanvasElement;
}

/**
 * Represents the resolved Emscripten module instance.
 * This is what the Promise from the factory function resolves to.
 */
export interface WasmInstance {
  _main: () => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAPF32: Float32Array;
  AudioToClock: new (
    config: any, // Should be AudioToClockConfig, but keeping it simple for now
    onStatusUpdated: (message: string, isError: boolean) => void,
    onExternalClockAdjusted: (changes: { bpm?: number; phase?: number; timestamp: number; type: string; }) => void,
    onDebugDataExported: (debugData: any) => void,
    runFeatureExtractor: any,
    runBpmPhasePredictor: any
  ) => {
    addAudio: (audioSamplesPtr: number, numChannels: number, numSamples: number, currentTime: number, inputSampleRate: number) => void;
    start: () => void;
    stop: () => void;
  };
  [key: string]: any;
}

type EmscriptenModuleFactory = (options?: EmscriptenModuleOptions) => Promise<WasmInstance>;

const createAudioToClockWasm: EmscriptenModuleFactory;
export default createAudioToClockWasm;
