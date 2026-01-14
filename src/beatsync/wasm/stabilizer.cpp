#include "stabilizer.h"
#include "extrapolation.h"
#include <algorithm>
#include <cmath>
#include <numeric>

// ... (utility functions like wrap, wrapSigned, etc. would go here or in a
// utils file)

class TrajectoryState {
public:
  int id;
  double phase;
  double barPhase;
  double magnitude;
  double bpm;
  double weight;
  double lastUpdateTime;
  std::vector<double> bpmDeltaHistory;
  std::vector<double> phaseDeltaHistory;

  TrajectoryState(double p, double bp, double m, double b, double w, double lut)
      : id(nextId++), phase(p), barPhase(bp), magnitude(m), bpm(b), weight(w),
        lastUpdateTime(lut) {}

  double predictPhase(double currentTime) const {
    return ::predictPhase(
        {id, phase, barPhase, magnitude, bpm, weight, lastUpdateTime},
        currentTime);
  }

  double predictBarPhase(double currentTime) const {
    return ::predictBarPhase(
        {id, phase, barPhase, magnitude, bpm, weight, lastUpdateTime},
        currentTime);
  }

  void update(double newPhase, double newBarPhase, double newMagnitude,
              double newBpm, double weightIncrement, double currentTime,
              double shiftWeight, const StabilizerConfig &config);

  void decay(double decayFactor, double currentTime) {
    double timeSinceUpdate = currentTime - lastUpdateTime;
    weight *= std::pow(decayFactor, timeSinceUpdate);
  }

  StabilizerTrajectory toDebugData() const {
    return {id, phase, barPhase, magnitude, bpm, weight, lastUpdateTime};
  }

private:
  static int nextId;
};

int TrajectoryState::nextId = 0;

void TrajectoryState::update(double newPhase, double newBarPhase,
                             double newMagnitude, double newBpm,
                             double weightIncrement, double currentTime,
                             double shiftWeight,
                             const StabilizerConfig &config) {
  double shiftWeightIncrement = std::max(0.0, weightIncrement);
  double bpmPhaseWeightIncrement = shiftWeightIncrement * shiftWeight;
  double biasedWeight = weight + config.shiftWeightBias;

  double oldPhase = predictPhase(currentTime);
  double oldBpm = bpm;

  // --- Phase Update ---
  double phaseDiff =
      std::atan2(std::sin(newPhase - oldPhase), std::cos(newPhase - oldPhase));
  double avgPhaseDelta =
      std::accumulate(phaseDeltaHistory.begin(), phaseDeltaHistory.end(), 0.0) /
      (phaseDeltaHistory.size() ? phaseDeltaHistory.size() : 1);
  bool isPhaseDirectionConsistent =
      phaseDeltaHistory.empty() || (phaseDiff > 0) == (avgPhaseDelta > 0);

  bool shouldOvercorrectPhase =
      weight > config.overcorrectionWeightThreshold &&
      std::abs(oldBpm - newBpm) < config.overcorrectionBpmThreshold &&
      std::abs(phaseDiff) < config.overcorrectionPhaseThreshold &&
      isPhaseDirectionConsistent;

  double targetPhase = newPhase;
  if (shouldOvercorrectPhase) {
    targetPhase = newPhase + phaseDiff * config.phaseOvercorrectionFactor;
  }

  double avgSinPhase = std::sin(oldPhase) * biasedWeight +
                       std::sin(targetPhase) * bpmPhaseWeightIncrement;
  double avgCosPhase = std::cos(oldPhase) * biasedWeight +
                       std::cos(targetPhase) * bpmPhaseWeightIncrement;
  double updatedPhase = std::atan2(avgSinPhase, avgCosPhase);
  // wrap
  updatedPhase = std::fmod(updatedPhase, 2 * M_PI);
  if (updatedPhase < 0)
    updatedPhase += 2 * M_PI;

  this->phase = updatedPhase;

  double appliedPhaseDelta =
      std::fmod(updatedPhase - oldPhase + M_PI, 2 * M_PI) - M_PI;
  phaseDeltaHistory.push_back(appliedPhaseDelta);
  if (phaseDeltaHistory.size() > config.deltaHistorySize) {
    phaseDeltaHistory.erase(phaseDeltaHistory.begin());
  }

  // --- Bar Phase Update ---
  double phaseDelta01 = appliedPhaseDelta / (2 * M_PI);
  double oldBarPhase = predictBarPhase(currentTime);
  double updatedBarPhase = oldBarPhase + phaseDelta01;
  double newBarBeat = std::round(updatedBarPhase - (updatedPhase / (2 * M_PI)));
  updatedBarPhase = newBarBeat + (updatedPhase / (2 * M_PI));
  updatedBarPhase = std::fmod(updatedBarPhase, 4.0);
  if (updatedBarPhase < 0)
    updatedBarPhase += 4.0;
  this->barPhase = updatedBarPhase;

  // --- BPM Update ---
  double bpmDiff = newBpm - oldBpm;
  double avgBpmDelta =
      std::accumulate(bpmDeltaHistory.begin(), bpmDeltaHistory.end(), 0.0) /
      (bpmDeltaHistory.size() ? bpmDeltaHistory.size() : 1);
  bool isBpmDirectionConsistent =
      bpmDeltaHistory.empty() || (bpmDiff > 0) == (avgBpmDelta > 0);

  bool shouldOvercorrectBpm =
      weight > config.overcorrectionWeightThreshold &&
      std::abs(bpmDiff) < config.overcorrectionBpmThreshold &&
      isBpmDirectionConsistent;

  double targetBpm = newBpm;
  if (shouldOvercorrectBpm) {
    targetBpm = newBpm + bpmDiff * config.bpmOvercorrectionFactor;
  }

  if (biasedWeight + bpmPhaseWeightIncrement > 0) {
    double updatedBpm =
        (oldBpm * biasedWeight + targetBpm * bpmPhaseWeightIncrement) /
        (biasedWeight + bpmPhaseWeightIncrement);
    double appliedBpmDelta = updatedBpm - oldBpm;
    bpmDeltaHistory.push_back(appliedBpmDelta);
    if (bpmDeltaHistory.size() > config.deltaHistorySize) {
      bpmDeltaHistory.erase(bpmDeltaHistory.begin());
    }
    this->bpm = updatedBpm;
  }

  // --- Magnitude and Weight update ---
  double newWeight = weight + weightIncrement;
  if (newWeight > 0) {
    this->magnitude =
        (this->magnitude * this->weight + newMagnitude * weightIncrement) /
        newWeight;
  }
  this->weight = std::min(config.maxWeight, newWeight);
  this->lastUpdateTime = currentTime;
}

Stabilizer::Stabilizer(
    const StabilizerConfig &config,
    std::function<void(const StabilizerTrajectory &)> onTrajectoryUpdated,
    std::function<void(const StabilizerDebugData &)> onDebugDataUpdated)
    : config_(config), onTrajectoryUpdated_(onTrajectoryUpdated),
      onDebugDataUpdated_(onDebugDataUpdated) {}

Stabilizer::~Stabilizer() {}

void Stabilizer::resync() {
  for (auto &trajectory : trajectories_) {
    trajectory.barPhase =
        fmod(trajectory.barPhase - floor(trajectory.barPhase + 0.5), 4.0);
    if (trajectory.barPhase < 0.0) {
      trajectory.barPhase += 4.0;
    }
    trajectory.barPhase += 4.0;
  }
}

void Stabilizer::addPrediction(double phase, double magnitude, double bpm,
                               double currentTime) {
  bpmHistory_.push_back(bpm);
  if (bpmHistory_.size() > historySize_) {
    bpmHistory_.erase(bpmHistory_.begin());
  }

  lastBpmVariance_ = calculateVariance(bpmHistory_);
  overallConfidence_ =
      std::min(1.0, std::max(0.0, config_.bpmWeightScale /
                                          (1.0 + config_.bpmVariancePenalty *
                                                     lastBpmVariance_) +
                                      config_.bpmWeightBias));
  double modulatedWeightIncrement =
      config_.weightIncrement * overallConfidence_;

  bool foundMatch = false;
  double bestBarPhase =
      bestTrajectory_ ? bestTrajectory_->predictBarPhase(currentTime) : 0.0;
  for (auto &trajectory : trajectories_) {
    double predictedPhase = trajectory.predictPhase(currentTime);
    double phaseDifference = std::abs(predictedPhase - phase);

    if (phaseDifference < config_.proximityThreshold) {
      trajectory.update(phase, bestBarPhase, magnitude, bpm,
                        modulatedWeightIncrement, currentTime,
                        config_.shiftWeight, config_);
      foundMatch = true;
      break;
    }
  }

  if (!foundMatch) {
    double averageBpm =
        std::accumulate(bpmHistory_.begin(), bpmHistory_.end(), 0.0) /
        bpmHistory_.size();

    double newBarPhase;
    if (bestTrajectory_) {
      double best_bar_phase = bestTrajectory_->predictBarPhase(currentTime);
      newBarPhase = round(best_bar_phase) + (phase / (2 * M_PI));
    } else {
      newBarPhase = phase / (2 * M_PI);
    }

    trajectories_.emplace_back(phase, newBarPhase, magnitude, averageBpm,
                               config_.initialWeight * overallConfidence_,
                               currentTime);
  }

  decayAndPrune(currentTime);
  findBestTrajectory(currentTime);

  findBestTrajectory(currentTime);

  if (config_.exportDebugData || forceExportAllDebugData_) {
    doExportDebugData(currentTime);
  }

  if (bestTrajectory_) {
    auto bestTrajDebugData = bestTrajectory_->toDebugData();
    onTrajectoryUpdated_(bestTrajDebugData);
  }
}

void Stabilizer::SetForceExportAllDebugData(bool forceExport) {
  forceExportAllDebugData_ = forceExport;
}

void Stabilizer::doExportDebugData(double currentTime) {
  std::vector<StabilizerTrajectory> trajectories;
  for (const auto &traj : trajectories_) {
    trajectories.push_back(traj.toDebugData());
  }

  StabilizerTrajectory bestTrajectory_copy;
  bool hasBestTrajectory = false;
  if (bestTrajectory_) {
    bestTrajectory_copy = bestTrajectory_->toDebugData();
    hasBestTrajectory = true;
  }

  onDebugDataUpdated_({trajectories, bestTrajectory_copy, hasBestTrajectory,
                       overallConfidence_, lastBpmVariance_, bpmHistory_});
}

double Stabilizer::calculateVariance(const std::vector<double> &data) {
  if (data.size() < 2) {
    return 0;
  }
  double mean = std::accumulate(data.begin(), data.end(), 0.0) / data.size();
  double variance = 0.0;
  for (double x : data) {
    variance += std::pow(x - mean, 2);
  }
  return variance / data.size();
}

void Stabilizer::decayAndPrune(double currentTime) {
  for (auto &t : trajectories_) {
    t.decay(config_.decayFactor, currentTime);
  }
  trajectories_.erase(
      std::remove_if(trajectories_.begin(), trajectories_.end(),
                     [this](const TrajectoryState &t) {
                       return t.weight <= config_.pruneThreshold &&
                              (!bestTrajectory_ || t.id != bestTrajectory_->id);
                     }),
      trajectories_.end());
}

void Stabilizer::findBestTrajectory(double currentTime) {
  if (trajectories_.empty()) {
    bestTrajectory_ = nullptr;
    return;
  }

  double bestWeight = -1;
  TrajectoryState *currentBest = nullptr;

  for (auto &trajectory : trajectories_) {
    double effectiveWeight = trajectory.weight;
    if (bestTrajectory_ && trajectory.id == bestTrajectory_->id) {
      effectiveWeight += config_.bestTrajectoryBias;
    }

    if (effectiveWeight > bestWeight) {
      bestWeight = effectiveWeight;
      currentBest = &trajectory;
    }
  }
  bestTrajectory_ = currentBest;
}

double Stabilizer::predictPhase(const StabilizerTrajectory &sample,
                                double currentTime) {
  const double timeSinceUpdate = currentTime - sample.lastUpdateTime;
  const double ibi = 60.0 / sample.bpm;
  const double phaseAdvance = (timeSinceUpdate / ibi) * 2 * M_PI;
  double predictedPhase = sample.phase + phaseAdvance;
  return std::atan2(std::sin(predictedPhase), std::cos(predictedPhase));
}

double Stabilizer::predictBarPhase(const StabilizerTrajectory &sample,
                                   double currentTime) {
  const double timeSinceUpdate = currentTime - sample.lastUpdateTime;
  const double ibi = 60.0 / sample.bpm;
  const double beatsAdvanced = timeSinceUpdate / ibi;
  return sample.barPhase + beatsAdvanced;
}
