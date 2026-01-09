#pragma once

#include "schema.h"
#include "audio_utils.h"
#include <functional>
#include <vector>

// Audio constants (from config_audio.ts)
constexpr int ODF_CHANNELS = 3;
constexpr int HI_RES_HOP_LENGTH = 64;
constexpr int LOW_RES_HOP_LENGTH = 512;
constexpr int SPEC_CHANNELS = 128;
constexpr int MAX_QUEUED_BLOCKS = 512;


struct AudioBlock {
    std::vector<double> data;
    double timestamp;
};

class InferenceManager {
public:
    enum class State {
        Idle,
        ExpectingFeatures,
        ExpectingPrediction
    };

    InferenceManager(const InferenceManagerConfig& config,
                     std::function<void(const BpmPhasePredictorResult&, const InferenceManagerDebugData&)> onPrediction,
                     std::function<void(const std::vector<float>&)> requestFeatureExtractor,
                     std::function<void(const std::vector<float>&, const std::vector<float>&, double)> requestBpmPhasePredictor);

    void addAudio(const std::vector<std::vector<float>>& channels, double currentTime, int inputSampleRate);

    void process();
    void onFeaturesReady(const FeatureExtractorResult& features);
    void onPredictionReady(const BpmPhasePredictorResult& result);
    void SetForceExportAllDebugData(bool forceExport); // New method

private:
    void processHops();
    AudioBlock getAudioChunk(size_t numSamples);
    void consumeAudio(size_t numSamples);
    void doExportDebugData();

    InferenceManagerConfig config_;
    std::function<void(const BpmPhasePredictorResult&, const InferenceManagerDebugData&)> onPrediction_;
    std::function<void(const std::vector<float>&)> requestFeatureExtractor_;
    std::function<void(const std::vector<float>&, const std::vector<float>&, double)> requestBpmPhasePredictor_;

    Resampler resampler_;
    std::vector<AudioBlock> audioBlocks_;
    std::vector<float> odfWindow_;
    std::vector<float> specWindow_;
    int hopCounter_ = 0;
    InferenceManagerDebugData debugData_;

    // State members
    State state_ = State::Idle;
    AudioBlock pending_chunk_;
    int numHopsToProcess_ = 0;
    int currentHop_ = 0;
    FeatureExtractorResult features_;
};