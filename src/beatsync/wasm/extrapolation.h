#pragma once

#include "stabilizer.h"

double predictPhase(const StabilizerTrajectory& trajectory, double currentTime);
double predictBarPhase(const StabilizerTrajectory& trajectory, double currentTime);
