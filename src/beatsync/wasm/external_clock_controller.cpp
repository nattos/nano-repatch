#include "external_clock_controller.h"
#include <chrono>
#include <cmath>
#include <numeric>

// Helper functions
double wrap(double x, double mod) {
  return std::fmod(std::fmod(x, mod) + mod, mod);
}

double wrapSigned(double x, double range) {
  double wrapped = wrap(x + range, range * 2);
  return wrapped - range;
}

ExternalClockController::ExternalClockController(
    const ExternalClockControllerConfig &config,
    std::function<void(const ExternalClockAdjustEvent &)> onClockAdjusted,
    std::function<void(const ExternalClockDebugData &,
                       const std::optional<ExternalClockAdjustEvent> &)>
        onDebugDataUpdated)
    : config_(config), onClockAdjusted_(onClockAdjusted),
      onDebugDataUpdated_(onDebugDataUpdated) {}

ExternalClockController::~ExternalClockController() {
  if (scheduledBpmCorrection_) {
    delete scheduledBpmCorrection_;
  }
}

void ExternalClockController::update(double predictedBpm, double predictedPhase,
                                     double predictedBarPhase,
                                     double currentTime) {
  bpmFilterHistories_.push_back(predictedBpm);
  if (bpmFilterHistories_.size() > config_.bpmFilterWindowLength) {
    bpmFilterHistories_.erase(bpmFilterHistories_.begin());
  }
  double averageBpm = std::accumulate(bpmFilterHistories_.begin(),
                                      bpmFilterHistories_.end(), 0.0) /
                      bpmFilterHistories_.size();
  latestPredictedBpm_ = averageBpm;

  phaseFilterHistories_.push_back({predictedPhase, currentTime});
  if (phaseFilterHistories_.size() > config_.phaseFilterWindowLength) {
    phaseFilterHistories_.erase(phaseFilterHistories_.begin());
  }

  double sumSin = 0;
  double sumCos = 0;
  for (const auto &obs : phaseFilterHistories_) {
    double timeDiff = currentTime - obs.time;
    double phaseAdvance = (timeDiff * averageBpm / 60.0) * 2 * M_PI;
    double projectedPhase = obs.phase + phaseAdvance;
    projectedPhase = wrap(projectedPhase, 2 * M_PI);
    sumSin += std::sin(projectedPhase);
    sumCos += std::cos(projectedPhase);
  }

  double averagePhase = std::atan2(sumSin, sumCos);
  latestPredictedPhase_ = averagePhase;
  latestPredictedBarPhase_ = predictedBarPhase;
}

void ExternalClockController::tick(double currentTime) {
  double predictedBpm = latestPredictedBpm_;
  double predictedPhase = latestPredictedPhase_;
  double predictedBarPhase = latestPredictedBarPhase_;

  if (lastUpdateTime_ == 0) {
    externalBpm_ = predictedBpm;
    externalPhase_ = predictedPhase;
    externalBarPhase_ = predictedBarPhase;
    lastBpmChangeTime_ = currentTime;
    lastUpdateTime_ = currentTime;
    doExportDebugData(std::nullopt);
    onClockAdjusted_({externalBpm_, externalPhase_, currentTime,
                      ExternalClockAdjustType::Sync});
    return;
  }

  double dt = currentTime - lastUpdateTime_;
  if (dt <= 0)
    return;

  std::optional<ExternalClockAdjustType> didUpdateWithType = std::nullopt;

  // 1. Simulate our external clock forward
  double tickPhaseAdvance = (dt * externalBpm_ / 60.0) * 2 * M_PI;
  externalPhase_ += tickPhaseAdvance;
  // Ensure absolute lock-step!
  double externalPhase01 = wrap(externalPhase_ / M_PI / 2.0, 1.0);
  if (std::round(predictedBarPhase) != std::round(externalBarPhase_)) {
    externalBarPhase_ = predictedBarPhase;
  }
  externalBarPhase_ =
      std::round(externalBarPhase_ + tickPhaseAdvance / M_PI / 2.0 -
                 externalPhase01) +
      externalPhase01;

  // 2. Check for scheduled BPM corrections
  if (scheduledBpmCorrection_ && currentTime >= scheduledBpmCorrection_->time) {
    externalBpm_ = scheduledBpmCorrection_->bpm;
    lastBpmChangeTime_ = currentTime;
    didUpdateWithType = ExternalClockAdjustType::Nudge;
    delete scheduledBpmCorrection_;
    scheduledBpmCorrection_ = nullptr;
  }

  // 3. Calculate phase error by predicting future phases
  const double predictionHorizonS = config_.predictionHorizonS;
  const double futureInternalPhase =
      predictedPhase + (predictionHorizonS * predictedBpm / 60.0) * 2 * M_PI;

  double predictionPhaseAdvance;
  const double dtCorrection = scheduledBpmCorrection_
                                  ? scheduledBpmCorrection_->time - currentTime
                                  : -1;

  if (scheduledBpmCorrection_ && dtCorrection > 0 &&
      dtCorrection < predictionHorizonS) {
    const double currentBpmPhaseAdvance = dtCorrection * externalBpm_;
    const double futureBpmPhaseAdvance =
        (predictionHorizonS - dtCorrection) * scheduledBpmCorrection_->bpm;
    predictionPhaseAdvance =
        (currentBpmPhaseAdvance + futureBpmPhaseAdvance) / 60.0 * 2 * M_PI;
  } else {
    predictionPhaseAdvance =
        (predictionHorizonS * externalBpm_ / 60.0) * 2 * M_PI;
  }
  const double futureExternalPhase = externalPhase_ + predictionPhaseAdvance;
  const double phaseError =
      wrapSigned(futureInternalPhase - futureExternalPhase, M_PI);

  // 4. Decide on correction
  const double bpmNudgeRequired =
      (phaseError * 60.0) / (2.0 * M_PI * config_.predictionHorizonS);

  if ((std::abs(phaseError) > config_.largePhaseErrorThreshold &&
       std::abs(bpmNudgeRequired) > config_.bpmNudgeThreshold) ||
      std::abs(predictedBpm - externalBpm_) >
          config_.largeBpmDifferenceThreshold) {
    // Hard reset
    externalBpm_ = predictedBpm;
    externalPhase_ = predictedPhase;
    lastBpmChangeTime_ = currentTime;
    didUpdateWithType = ExternalClockAdjustType::Sync;
    if (scheduledBpmCorrection_) {
      delete scheduledBpmCorrection_;
      scheduledBpmCorrection_ = nullptr;
    }
  } else if ((!scheduledBpmCorrection_ ||
              (currentTime - scheduledBpmCorrection_->scheduledAt) >
                  config_.minNudgeIntervalS) &&
             std::abs(phaseError) > config_.phaseCorrectionThreshold) {
    // Nudge BPM to correct phase over predictionHorizonS seconds.
    const double bpmNudge = bpmNudgeRequired;
    externalBpm_ += bpmNudge;
    lastBpmChangeTime_ = currentTime;
    didUpdateWithType = ExternalClockAdjustType::Nudge;

    // Schedule a correction back to the predicted BPM
    if (scheduledBpmCorrection_) {
      delete scheduledBpmCorrection_;
    }
    scheduledBpmCorrection_ = new ScheduledBpmCorrection{
        currentTime + config_.predictionHorizonS,
        predictedBpm,
        currentTime,
    };
  } else if (!scheduledBpmCorrection_) {
    const double bpmDifference = predictedBpm - externalBpm_;
    const double timeSinceLastBpmChange = currentTime - lastBpmChangeTime_;

    if (timeSinceLastBpmChange > config_.bpmTightDriftIntervalS &&
        std::abs(bpmDifference) > config_.bpmTightDriftThreshold) {
      // Snap BPM
      externalBpm_ = predictedBpm;
      lastBpmChangeTime_ = currentTime;
      didUpdateWithType = ExternalClockAdjustType::Nudge;
    } else if (std::abs(bpmDifference) > config_.bpmDriftThreshold) {
      // No correction scheduled and phase error is small, slowly drift towards
      // predicted BPM
      externalBpm_ = predictedBpm;
      lastBpmChangeTime_ = currentTime;
      didUpdateWithType = ExternalClockAdjustType::Nudge;
    }
  }

  lastUpdateTime_ = currentTime;

  std::optional<ExternalClockAdjustEvent> eventToReport = std::nullopt;
  if (didUpdateWithType) {
    std::optional<double> bpmToReport = externalBpm_;
    std::optional<double> phaseToReport = std::nullopt;
    if (didUpdateWithType == ExternalClockAdjustType::Sync) {
      phaseToReport = externalPhase_;
    }
    eventToReport = ExternalClockAdjustEvent{
        bpmToReport, phaseToReport, currentTime, didUpdateWithType.value()};
    onClockAdjusted_(eventToReport.value());
  }
  doExportDebugData(eventToReport);
}

void ExternalClockController::SetForceExportAllDebugData(bool forceExport) {
  forceExportAllDebugData_ = forceExport;
}

void ExternalClockController::doExportDebugData(
    const std::optional<ExternalClockAdjustEvent> &event) {
  if (config_.exportDebugData || forceExportAllDebugData_) {
    ExternalClockDebugData data;
    data.lastUpdateTime = lastUpdateTime_;
    data.bpm = externalBpm_;
    data.phase = externalPhase_;
    data.barPhase = externalBarPhase_;
    if (scheduledBpmCorrection_) {
      data.scheduledBpmCorrection = *scheduledBpmCorrection_;
    }
    onDebugDataUpdated_(data, event);
  }
}

float ExternalClockController::getBarPhase() const { return externalBarPhase_; }

void ExternalClockController::resync() {
  externalBarPhase_ = externalBarPhase_ - floor(externalBarPhase_ + 0.5);
  if (externalBarPhase_ < 0.0) {
    externalBarPhase_ += 4.0;
  }
  externalBarPhase_ += 4.0;
  latestPredictedBarPhase_ =
      latestPredictedBarPhase_ - floor(latestPredictedBarPhase_ + 0.5);
  if (latestPredictedBarPhase_ < 0.0) {
    latestPredictedBarPhase_ += 4.0;
  }
  latestPredictedBarPhase_ += 4.0;
}
