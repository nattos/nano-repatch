#pragma once

#include "audio_to_clock.h" // Include the new core class header
#include <emscripten/val.h>
#include <deque>
#include <optional>
#include <memory> // For std::unique_ptr

class AudioToClockWasm { // Renamed to avoid conflict with core class
public:
    AudioToClockWasm(emscripten::val config,
                     emscripten::val onStatusUpdated,
                     emscripten::val onExternalClockAdjusted,
                     emscripten::val onDebugDataExported,
                     emscripten::val runFeatureExtractor,
                     emscripten::val runBpmPhasePredictor);

    void addAudio(uintptr_t audioSamplesPtr, int numChannels, int numSamples, double currentTime, int inputSampleRate);
    void tick(double currentTime);

    void resolveFeatureExtractor(uintptr_t odfDataPtr, size_t odfLength, uintptr_t specDataPtr, size_t specLength);
    void resolveBpmPhasePredictor(emscripten::val result);

private:
    // Store the emscripten::val callbacks
    emscripten::val onStatusUpdated_;
    emscripten::val onExternalClockAdjusted_;
    emscripten::val onDebugDataExported_;
    emscripten::val runFeatureExtractor_;
    emscripten::val runBpmPhasePredictor_;

    // Instance of the core AudioToClock class
    std::unique_ptr<AudioToClock> audioToClockCore_;
};
