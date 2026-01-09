#include "audio_utils.h"
#include <numeric>

std::vector<float> downmix(const std::vector<std::vector<float>>& channels) {
    if (channels.empty()) {
        return {};
    }
    if (channels.size() == 1) {
        return channels[0];
    }

    size_t numChannels = channels.size();
    size_t length = channels[0].size();
    std::vector<float> result(length, 0.0f);

    for (size_t i = 0; i < length; ++i) {
        float sum = 0.0f;
        for (size_t j = 0; j < numChannels; ++j) {
            sum += channels[j][i];
        }
        result[i] = sum / numChannels;
    }
    return result;
}

Resampler::Resampler(int inputSampleRate, int outputSampleRate)
    : inputSampleRate_(inputSampleRate), outputSampleRate_(outputSampleRate) {}

void Resampler::addData(const std::vector<float>& data) {
    buffer_.reserve(buffer_.size() + data.size());
    for (float val : data) {
        buffer_.push_back(static_cast<double>(val));
    }
}

std::vector<double> Resampler::resample() {
    double ratio = static_cast<double>(inputSampleRate_) / outputSampleRate_;
    if (buffer_.size() < ratio) {
        return {};
    }

    size_t outputLength = static_cast<size_t>((buffer_.size() - 1) / ratio);
    if (outputLength == 0) {
        return {};
    }

    std::vector<double> outputData(outputLength);
    for (size_t i = 0; i < outputLength; ++i) {
        double inputIndex = i * ratio;
        size_t lowIndex = static_cast<size_t>(inputIndex);
        size_t highIndex = lowIndex + 1;
        double weight = inputIndex - lowIndex;

        double lowValue = buffer_[lowIndex];
        double highValue = buffer_[highIndex];
        outputData[i] = lowValue + (highValue - lowValue) * weight;
    }

    size_t consumedInput = static_cast<size_t>(outputLength * ratio);
    buffer_.erase(buffer_.begin(), buffer_.begin() + consumedInput);

    return outputData;
}

void Resampler::reset() {
    buffer_.clear();
}
