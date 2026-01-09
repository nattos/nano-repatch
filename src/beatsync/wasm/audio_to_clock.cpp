#include "audio_to_clock.h"
#include <cmath>
#include <iostream>
#include <numeric>
#include <chrono>

// No Emscripten-specific includes here

AudioToClock::AudioToClock(const AudioToClockConfig& config,
                           OnPredictionReadyCallback onPredictionReady,
                           OnRequestFeatureExtractionCallback onRequestFeatureExtraction,
                           OnRequestBpmPhasePredictionCallback onRequestBpmPhasePrediction,
                           OnBestTrajectoryCallback onBestTrajectory,
                           OnStabilizerDebugDataCallback onStabilizerDebugData,
                           OnExternalClockAdjustedCallback onExternalClockAdjusted,
                           OnExternalClockDebugDataCallback onExternalClockDebugData)
    : inferenceManager_(
          config.inferenceConfig,
          [this, onPredictionReady](const BpmPhasePredictorResult& result, const InferenceManagerDebugData& debugData) {
            stabilizer_.addPrediction(result.phase, result.phaseMagnitude, result.bpm, result.inputTime);
            onPredictionReady(result, debugData);
          },
          onRequestFeatureExtraction,
          onRequestBpmPhasePrediction
      ),
      stabilizer_(
          config.stabilizerConfig,
          [this, onBestTrajectory](const StabilizerTrajectory& bestTrajectory) {
              externalClockController_.update(
                bestTrajectory.bpm,
                Stabilizer::predictPhase(bestTrajectory, latestTimestamp_),
                Stabilizer::predictBarPhase(bestTrajectory, latestTimestamp_),
                latestTimestamp_);
              onBestTrajectory(bestTrajectory);
          },
          onStabilizerDebugData
      ),
      externalClockController_(
          config.externalClockControllerConfig,
          onExternalClockAdjusted,
          onExternalClockDebugData
      )
{
    // No onStatusUpdated here, as it's WASM-specific
}

void AudioToClock::SetForceExportAllDebugData(bool forceExport) {
    inferenceManager_.SetForceExportAllDebugData(forceExport);
    stabilizer_.SetForceExportAllDebugData(forceExport);
    externalClockController_.SetForceExportAllDebugData(forceExport);
}

void AudioToClock::addAudio(uintptr_t audioSamplesPtr, int numChannels, int numSamples, double currentTime, int inputSampleRate) {
    latestTimestamp_ = currentTime;
    float* audioSamples = reinterpret_cast<float*>(audioSamplesPtr);

    std::vector<std::vector<float>> channels(numChannels);
    for (int i = 0; i < numChannels; ++i) {
        channels[i].resize(numSamples);
        std::copy(audioSamples + i * numSamples, audioSamples + (i + 1) * numSamples, channels[i].begin());
    }

    inferenceManager_.addAudio(channels, currentTime, inputSampleRate);
    inferenceManager_.process();
}

void AudioToClock::resolveFeatureExtractor(uintptr_t odfDataPtr, size_t odfLength, uintptr_t specDataPtr, size_t specLength) {
    FeatureExtractorResult res;
    float* odfData = reinterpret_cast<float*>(odfDataPtr);
    float* specData = reinterpret_cast<float*>(specDataPtr);
    res.odf.assign(odfData, odfData + odfLength);
    res.spec.assign(specData, specData + specLength);
    inferenceManager_.onFeaturesReady(res);
}

void AudioToClock::resolveBpmPhasePredictor(const BpmPhasePredictorResult& result) {
    inferenceManager_.onPredictionReady(result);
}

void AudioToClock::tick(double currentTime) {
    externalClockController_.tick(currentTime);
}

void AudioToClock::resync() {
    externalClockController_.resync();
    stabilizer_.resync();
}

double AudioToClock::getBarPhase() const {
    return externalClockController_.getBarPhase();
}
