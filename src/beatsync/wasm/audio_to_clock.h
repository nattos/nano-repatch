#pragma once

#include "schema.h"
#include "inference_manager.h"
#include "stabilizer.h"
#include "external_clock_controller.h"
#include <deque>
#include <optional>
#include <vector>
#include <functional> // Added for std::function

class AudioToClock {
public:
    // Callbacks for the WASM wrapper to implement
    using OnPredictionReadyCallback = std::function<void(const BpmPhasePredictorResult& result, const InferenceManagerDebugData& debugData)>;
    using OnRequestFeatureExtractionCallback = std::function<void(const std::vector<float>& audio)>;
    using OnRequestBpmPhasePredictionCallback = std::function<void(const std::vector<float>& odf, const std::vector<float>& spec, double inputTime)>;
    using OnBestTrajectoryCallback = std::function<void(const StabilizerTrajectory& bestTrajectory)>;
    using OnStabilizerDebugDataCallback = std::function<void(const StabilizerDebugData& data)>;
    using OnExternalClockAdjustedCallback = std::function<void(const ExternalClockAdjustEvent& event)>;
    using OnExternalClockDebugDataCallback = std::function<void(const ExternalClockDebugData& data, const std::optional<ExternalClockAdjustEvent>& event)>;

    AudioToClock(const AudioToClockConfig& config,
                 OnPredictionReadyCallback onPredictionReady,
                 OnRequestFeatureExtractionCallback onRequestFeatureExtraction,
                 OnRequestBpmPhasePredictionCallback onRequestBpmPhasePrediction,
                 OnBestTrajectoryCallback onBestTrajectory,
                 OnStabilizerDebugDataCallback onStabilizerDebugData,
                 OnExternalClockAdjustedCallback onExternalClockAdjusted,
                 OnExternalClockDebugDataCallback onExternalClockDebugData);

    void addAudio(uintptr_t audioSamplesPtr, int numChannels, int numSamples, double currentTime, int inputSampleRate);
    void tick(double currentTime);
    void resync();
    double getBarPhase() const;
    void SetForceExportAllDebugData(bool forceExport); // New method

    void resolveFeatureExtractor(uintptr_t odfDataPtr, size_t odfLength, uintptr_t specDataPtr, size_t specLength);
    void resolveBpmPhasePredictor(const BpmPhasePredictorResult& result); // Changed to take BpmPhasePredictorResult

private:
    double latestTimestamp_ = 0.0;
    InferenceManager inferenceManager_;
    Stabilizer stabilizer_;
    ExternalClockController externalClockController_;
    double latestTime_ = 0.0;
};