#pragma once

#include <vector>

std::vector<float> downmix(const std::vector<std::vector<float>>& channels);

class Resampler {
public:
    Resampler(int inputSampleRate, int outputSampleRate);
    void addData(const std::vector<float>& data);
    std::vector<double> resample();
    void reset();
    int getInputSampleRate() const { return inputSampleRate_; }

private:
    int inputSampleRate_;
    int outputSampleRate_;
    std::vector<double> buffer_;
};