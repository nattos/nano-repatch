#pragma once

#include <string>
#include <vector>
#include <functional>
#include <optional>


struct InferenceManagerConfig {
    int hopSamples;
    int maxHopsPerStep;
    int odfFrames;
    int specFrames;
    int inferenceInterval;
    int targetSampleRate;
    int lookbehindSamples;
    double delayCompensation;
    double specSliceFraction;
    bool exportDebugData;
};

// ... rest of the file

struct StabilizerConfig {
    double proximityThreshold;
    double maxWeight;
    double initialWeight;
    double weightIncrement;
    double decayFactor;
    double pruneThreshold;
    double bestTrajectoryBias;
    double bpmWeightScale;
    double bpmWeightBias;
    double bpmVariancePenalty;
    double shiftWeight;
    double shiftWeightBias;
    double overcorrectionWeightThreshold;
    double overcorrectionBpmThreshold;
    double overcorrectionPhaseThreshold;
    double bpmOvercorrectionFactor;
    double phaseOvercorrectionFactor;
    int deltaHistorySize;
    bool exportDebugData;
};

struct ExternalClockControllerConfig {
    double updateInterval;
    double largePhaseErrorThreshold;
    double largeBpmDifferenceThreshold;
    double phaseCorrectionThreshold;
    double predictionHorizonS;
    double bpmNudgeThreshold;
    double minNudgeIntervalS;
    double bpmDriftThreshold;
    double bpmTightDriftThreshold;
    double bpmTightDriftIntervalS;
    int bpmFilterWindowLength;
    int phaseFilterWindowLength;
    bool exportDebugData;
};

struct AudioToClockConfig {
    InferenceManagerConfig inferenceConfig;
    StabilizerConfig stabilizerConfig;
    ExternalClockControllerConfig externalClockControllerConfig;
    bool exportAllDebugData;
};

struct FeatureExtractorResult {
    std::vector<float> odf;
    std::vector<float> spec;
};

struct BpmPhasePredictorResult {
    double bpm;
    double phase;
    double phaseMagnitude;
    double inputTime;
    double phaseX;
    double phaseY;
};

struct InferenceManagerDebugData {
    double inputTime;
    double bpm;
    double phase;
    double phaseMagnitude;
    double phaseX;
    double phaseY;
    std::vector<std::vector<float>> odfWindow;
    std::vector<std::vector<float>> specWindow;
};

struct StabilizerTrajectory {
    int id;
    double phase;
    double barPhase;
    double magnitude;
    double bpm;
    double weight;
    double lastUpdateTime;
};

struct StabilizerDebugData {
    std::vector<StabilizerTrajectory> trajectories;
    StabilizerTrajectory bestTrajectory;
    bool hasBestTrajectory;
    double overallConfidence;
    double bpmVariance;
    std::vector<double> bpmHistory;
};

struct ScheduledBpmCorrection {
    double time;
    double bpm;
    double scheduledAt;
};

struct ExternalClockDebugData {
    double lastUpdateTime;
    double bpm;
    double phase;
    double barPhase;
    std::optional<ScheduledBpmCorrection> scheduledBpmCorrection;
};

enum class ExternalClockAdjustType {
    Sync,
    Nudge
};

struct ExternalClockAdjustEvent {
    std::optional<double> bpm;
    std::optional<double> phase;
    double timestamp;
    ExternalClockAdjustType type;
};
