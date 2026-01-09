#include "extrapolation.h"
#include <cmath>

double predictPhase(const StabilizerTrajectory& trajectory, double currentTime) {
    double timeSinceUpdate = currentTime - trajectory.lastUpdateTime;
    double ibi = 60.0 / trajectory.bpm;
    double phaseAdvance = (timeSinceUpdate / ibi) * 2 * M_PI;
    double predictedPhase = trajectory.phase + phaseAdvance;
    return std::atan2(std::sin(predictedPhase), std::cos(predictedPhase));
}

double predictBarPhase(const StabilizerTrajectory& trajectory, double currentTime) {
    double timeSinceUpdate = currentTime - trajectory.lastUpdateTime;
    double ibi = 60.0 / trajectory.bpm;
    double beatsAdvanced = timeSinceUpdate / ibi;
    return trajectory.barPhase + beatsAdvanced;
}
