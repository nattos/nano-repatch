#pragma once

#include "schema.h"
#include <functional>
#include <vector>

class TrajectoryState; // Forward declaration

class Stabilizer {
public:
  Stabilizer(
      const StabilizerConfig &config,
      std::function<void(const StabilizerTrajectory &)> onTrajectoryUpdated,
      std::function<void(const StabilizerDebugData &)> onDebugDataUpdated);
  ~Stabilizer();

  void addPrediction(double phase, double magnitude, double bpm,
                     double currentTime);
  void resync();

  static double predictPhase(const StabilizerTrajectory &sample,
                             double currentTime);
  static double predictBarPhase(const StabilizerTrajectory &sample,
                                double currentTime);
  void SetForceExportAllDebugData(bool forceExport); // New method

private:
  double calculateVariance(const std::vector<double> &data);
  void decayAndPrune(double currentTime);
  void findBestTrajectory(double currentTime);
  void doExportDebugData(double currentTime);

  StabilizerConfig config_;
  std::function<void(const StabilizerTrajectory &)> onTrajectoryUpdated_;
  std::function<void(const StabilizerDebugData &)> onDebugDataUpdated_;
  std::vector<TrajectoryState> trajectories_;
  TrajectoryState *bestTrajectory_ = nullptr;
  std::vector<double> bpmHistory_;
  double lastBpmVariance_ = 0.0;
  const int historySize_ = 8;
  double overallConfidence_ = 0.0;
  bool forceExportAllDebugData_ = false;
};