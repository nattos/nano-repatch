
import * as ort from 'onnxruntime-web';

ort.env.wasm.wasmPaths = "/";
// ort.env.webgpu.profiling = { mode: 'default' };

/**
 * A class to manage the loading and caching of ONNX models.
 */
export class ModelManager {
  private featureExtractorSession: ort.InferenceSession | null = null;
  private mainModelSession: ort.InferenceSession | null = null;
  private _isReady = false;

  /**
   * Returns true if both models have been loaded and are ready for inference.
   */
  public get isReady(): boolean {
    return this._isReady;
  }

  /**
   * Loads the feature extractor and main models.
   * @param featureExtractorUrl The URL path to the feature extractor ONNX model.
   * @param mainModelUrl The URL path to the main inference ONNX model.
   */
  public async loadModels(
    featureExtractorUrl: string,
    mainModelUrl: string
  ): Promise<void> {
    if (this.isReady) {
      console.log("Models are already loaded.");
      return;
    }

    console.log("Loading models...");
    try {
      // Create sessions sequentially to avoid race conditions with execution providers.
      // Create the main model session first to ensure WebGPU is prioritized.
      console.log("Loading main model with WebGPU support...");
      const mainSession = await ort.InferenceSession.create(mainModelUrl, {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all',
      });

      console.log("Loading feature extractor with CPU (WASM) support...");
      const featureSession = await ort.InferenceSession.create(featureExtractorUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      this.featureExtractorSession = featureSession;
      this.mainModelSession = mainSession;
      this._isReady = true;
      console.log("Models loaded successfully.");
    } catch (e) {
      console.error(`Failed to load models: ${e}`);
      throw e;
    }
  }

  /**
   * Gets the cached feature extractor session.
   * Throws an error if the model is not yet loaded.
   */
  public getFeatureExtractor(): ort.InferenceSession {
    if (!this.featureExtractorSession) {
      throw new Error('Feature extractor model is not loaded.');
    }
    return this.featureExtractorSession;
  }

  /**
   * Gets the cached main model session.
   * Throws an error if the model is not yet loaded.
   */
  public getMainModel(): ort.InferenceSession {
    if (!this.mainModelSession) {
      throw new Error('Main model is not loaded.');
    }
    return this.mainModelSession;
  }
}
