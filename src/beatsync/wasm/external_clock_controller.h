#pragma once

#include "schema.h"
#include <functional>
#include <vector>

class ExternalClockController {
public:
    ExternalClockController(const ExternalClockControllerConfig& config,
                            std::function<void(const ExternalClockAdjustEvent&)> onClockAdjusted,
                            std::function<void(const ExternalClockDebugData&, const std::optional<ExternalClockAdjustEvent>&)> onDebugDataUpdated);
    ~ExternalClockController();

    void update(double predictedBpm, double predictedPhase, double predictedBarPhase, double currentTime);
    void tick(double currentTime);

    float getBarPhase() const;

    void resync();
    void SetForceExportAllDebugData(bool forceExport); // New method

private:
    void doExportDebugData(const std::optional<ExternalClockAdjustEvent>& event);

    ExternalClockControllerConfig config_;
    std::function<void(const ExternalClockAdjustEvent&)> onClockAdjusted_;
    std::function<void(const ExternalClockDebugData&, const std::optional<ExternalClockAdjustEvent>&)> onDebugDataUpdated_;

    double externalBpm_ = 120.0;
    double externalPhase_ = 0.0;
    double externalBarPhase_ = 0.0;
    double lastUpdateTime_ = 0.0;

    ScheduledBpmCorrection* scheduledBpmCorrection_ = nullptr;

    double latestPredictedBpm_ = 120.0;
    double latestPredictedPhase_ = 0.0;
    double latestPredictedBarPhase_ = 0.0;

    double lastBpmChangeTime_ = 0.0;

    std::vector<double> bpmFilterHistories_;
    struct PhaseHistory {
        double phase;
        double time;
    };
    std::vector<PhaseHistory> phaseFilterHistories_;
};
