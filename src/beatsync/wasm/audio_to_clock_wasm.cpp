#include "audio_to_clock_wasm.h" // Now includes the new WASM wrapper header
#include "schema.h"
#include <chrono>
#include <cmath>
#include <emscripten/bind.h>
#include <emscripten/console.h>
#include <emscripten/threading.h>
#include <iostream>
#include <numeric>

// Helper function to safely get a value from an emscripten::val, with a default
// value
template <typename T>
T get_optional(emscripten::val const &obj, std::string const &name,
               T defaultValue) {
  if (obj[name].isUndefined()) {
    return defaultValue;
  }
  return obj[name].as<T>();
}

InferenceManagerConfig getInferenceManagerConfig(emscripten::val config) {
  InferenceManagerConfig imConfig;
  imConfig.hopSamples = get_optional<int>(config, "hopSamples", 512);
  imConfig.maxHopsPerStep = get_optional<int>(config, "maxHopsPerStep", 8);
  imConfig.odfFrames = get_optional<int>(config, "odfFrames", 0);
  imConfig.specFrames = get_optional<int>(config, "specFrames", 0);
  imConfig.inferenceInterval =
      get_optional<int>(config, "inferenceInterval", 1);
  imConfig.targetSampleRate =
      get_optional<int>(config, "targetSampleRate", 44100);
  imConfig.lookbehindSamples =
      get_optional<int>(config, "lookbehindSamples", 2048);
  imConfig.delayCompensation =
      get_optional<double>(config, "delayCompensation", 0.05);
  imConfig.specSliceFraction =
      get_optional<double>(config, "specSliceFraction", 0.25);
  imConfig.exportDebugData =
      get_optional<bool>(config, "exportDebugData", false);
  return imConfig;
}

StabilizerConfig getStabilizerConfig(emscripten::val config) {
  StabilizerConfig s_config;
  s_config.proximityThreshold =
      get_optional<double>(config, "proximityThreshold", M_PI / 5.0);
  s_config.maxWeight = get_optional<double>(config, "maxWeight", 20.0);
  s_config.initialWeight = get_optional<double>(config, "initialWeight", 1.0);
  s_config.weightIncrement =
      get_optional<double>(config, "weightIncrement", 3.0);
  s_config.decayFactor = get_optional<double>(config, "decayFactor", 0.4);
  s_config.pruneThreshold = get_optional<double>(config, "pruneThreshold", 0.1);
  s_config.bestTrajectoryBias =
      get_optional<double>(config, "bestTrajectoryBias", 15.0);
  s_config.bpmWeightScale =
      get_optional<double>(config, "bpmWeightScale", 100.0);
  s_config.bpmWeightBias = get_optional<double>(config, "bpmWeightBias", -0.2);
  s_config.bpmVariancePenalty =
      get_optional<double>(config, "bpmVariancePenalty", 45.0);
  s_config.shiftWeight = get_optional<double>(config, "shiftWeight", 0.5);
  s_config.shiftWeightBias =
      get_optional<double>(config, "shiftWeightBias", 1.5);
  s_config.overcorrectionWeightThreshold =
      get_optional<double>(config, "overcorrectionWeightThreshold", 10.0);
  s_config.overcorrectionBpmThreshold =
      get_optional<double>(config, "overcorrectionBpmThreshold", 0.3);
  s_config.overcorrectionPhaseThreshold =
      get_optional<double>(config, "overcorrectionPhaseThreshold", M_PI / 16.0);
  s_config.bpmOvercorrectionFactor =
      get_optional<double>(config, "bpmOvercorrectionFactor", 0.3);
  s_config.phaseOvercorrectionFactor =
      get_optional<double>(config, "phaseOvercorrectionFactor", 0.3);
  s_config.deltaHistorySize = get_optional<int>(config, "deltaHistorySize", 10);
  s_config.exportDebugData =
      get_optional<bool>(config, "exportDebugData", false);
  return s_config;
}

ExternalClockControllerConfig
getExternalClockControllerConfig(emscripten::val config) {
  ExternalClockControllerConfig ecc_config;
  ecc_config.updateInterval =
      get_optional<double>(config, "updateInterval", 1.0 / 30.0);
  ecc_config.largePhaseErrorThreshold =
      get_optional<double>(config, "largePhaseErrorThreshold", M_PI / 6.0);
  ecc_config.largeBpmDifferenceThreshold =
      get_optional<double>(config, "largeBpmDifferenceThreshold", 5.0);
  ecc_config.phaseCorrectionThreshold =
      get_optional<double>(config, "phaseCorrectionThreshold", M_PI / 8.0);
  ecc_config.predictionHorizonS =
      get_optional<double>(config, "predictionHorizonS", 5.0);
  ecc_config.bpmNudgeThreshold =
      get_optional<double>(config, "bpmNudgeThreshold", 4.0);
  ecc_config.minNudgeIntervalS =
      get_optional<double>(config, "minNudgeIntervalS", 1.0);
  ecc_config.bpmDriftThreshold =
      get_optional<double>(config, "bpmDriftThreshold", 0.5);
  ecc_config.bpmTightDriftThreshold =
      get_optional<double>(config, "bpmTightDriftThreshold", 0.01);
  ecc_config.bpmTightDriftIntervalS =
      get_optional<double>(config, "bpmTightDriftIntervalS", 2.0);
  ecc_config.bpmFilterWindowLength =
      get_optional<int>(config, "bpmFilterWindowLength", 5);
  ecc_config.phaseFilterWindowLength =
      get_optional<int>(config, "phaseFilterWindowLength", 5);
  ecc_config.exportDebugData =
      get_optional<bool>(config, "exportDebugData", false);
  return ecc_config;
}

std::vector<float> val_to_vector_float(const float *data_ptr, size_t length) {
  return std::vector<float>(data_ptr, data_ptr + length);
}

const emscripten::val vector_to_val_float(const std::vector<float> &vec) {
  return emscripten::val::global("Float32Array")
      .new_(emscripten::typed_memory_view(vec.size(), vec.data()));
}

AudioToClockWasm::AudioToClockWasm(emscripten::val configVal,
                                   emscripten::val onStatusUpdated,
                                   emscripten::val onExternalClockAdjusted,
                                   emscripten::val onDebugDataExported,
                                   emscripten::val runFeatureExtractor,
                                   emscripten::val runBpmPhasePredictor)
    : onStatusUpdated_(onStatusUpdated),
      onExternalClockAdjusted_(onExternalClockAdjusted),
      onDebugDataExported_(onDebugDataExported),
      runFeatureExtractor_(runFeatureExtractor),
      runBpmPhasePredictor_(runBpmPhasePredictor) {
  AudioToClockConfig config;
  config.inferenceConfig =
      getInferenceManagerConfig(configVal["inferenceConfig"]);
  config.stabilizerConfig = getStabilizerConfig(configVal["stabilizerConfig"]);
  config.externalClockControllerConfig = getExternalClockControllerConfig(
      configVal["externalClockControllerConfig"]);
  config.exportAllDebugData =
      get_optional<bool>(configVal, "exportAllDebugData", false);

  // Create std::function wrappers for the emscripten::val callbacks
  auto onPredictionReadyProxy =
      [this](const BpmPhasePredictorResult &result,
             const InferenceManagerDebugData &debugData) {
        emscripten::val inference = emscripten::val::object();
        inference.set("bpm", result.bpm);
        inference.set("phase", result.phase);
        inference.set("phaseMagnitude", result.phaseMagnitude);
        inference.set("inputTime", result.inputTime);
        inference.set("phaseX", result.phaseX);
        inference.set("phaseY", result.phaseY);
        std::vector<emscripten::val> outOdfWindowChannels;
        for (const std::vector<float> &channel : debugData.odfWindow) {
          outOdfWindowChannels.push_back(vector_to_val_float(channel));
        }
        emscripten::val outOdfWindow = emscripten::val::array(
            outOdfWindowChannels.begin(), outOdfWindowChannels.end());
        inference.set("odfWindow", outOdfWindow);

        std::vector<emscripten::val> outSpecWindowChannels;
        for (const std::vector<float> &channel : debugData.specWindow) {
          outSpecWindowChannels.push_back(vector_to_val_float(channel));
        }
        emscripten::val outSpecWindow = emscripten::val::array(
            outSpecWindowChannels.begin(), outSpecWindowChannels.end());
        inference.set("specWindow", outSpecWindow);

        emscripten::val updates = emscripten::val::object();
        updates.set("inference", inference);
        onDebugDataExported_(updates);
      };

  auto onRequestFeatureExtractionProxy =
      [this](const std::vector<float> &audio) {
        emscripten::val audioVal = vector_to_val_float(audio);
        runFeatureExtractor_(audioVal);
      };

  auto onRequestBpmPhasePredictionProxy = [this](const std::vector<float> &odf,
                                                 const std::vector<float> &spec,
                                                 double inputTime) {
    emscripten::val odfVal = vector_to_val_float(odf);
    emscripten::val specVal = vector_to_val_float(spec);
    runBpmPhasePredictor_(odfVal, specVal, inputTime);
  };

  auto onBestTrajectoryProxy =
      [this](const StabilizerTrajectory &bestTrajectory) {
        // This callback was originally used to update externalClockController_.
        // Now, the core AudioToClock handles this internally.
        // If there's a need to expose this to JS, it should be done via
        // onDebugDataExported_ or a new specific callback. For now, I'll assume
        // it's handled internally.
      };

  auto onStabilizerDebugDataProxy = [this](const StabilizerDebugData &data) {
    emscripten::val stabilizer = emscripten::val::object();
    stabilizer.set("overallConfidence", data.overallConfidence);
    stabilizer.set("bpmVariance", data.bpmVariance);
    // stabilizer.set("bpmHistory", vector_to_val_float(data.bpmHistory));

    std::vector<emscripten::val> trajectories;
    for (const auto &traj : data.trajectories) {
      emscripten::val t = emscripten::val::object();
      t.set("id", traj.id);
      t.set("phase", traj.phase);
      t.set("barPhase", traj.barPhase);
      t.set("magnitude", traj.magnitude);
      t.set("bpm", traj.bpm);
      t.set("weight", traj.weight);
      t.set("lastUpdateTime", traj.lastUpdateTime);
      trajectories.push_back(t);
    }
    stabilizer.set("trajectories", emscripten::val::array(trajectories.begin(),
                                                          trajectories.end()));

    if (data.hasBestTrajectory) {
      emscripten::val t = emscripten::val::object();
      t.set("id", data.bestTrajectory.id);
      t.set("phase", data.bestTrajectory.phase);
      t.set("barPhase", data.bestTrajectory.barPhase);
      t.set("magnitude", data.bestTrajectory.magnitude);
      t.set("bpm", data.bestTrajectory.bpm);
      t.set("weight", data.bestTrajectory.weight);
      t.set("lastUpdateTime", data.bestTrajectory.lastUpdateTime);
      stabilizer.set("bestTrajectory", t);
    } else {
      stabilizer.set("bestTrajectory", emscripten::val::null());
    }

    emscripten::val updates = emscripten::val::object();
    updates.set("stabilizer", stabilizer);
    onDebugDataExported_(updates);
  };

  auto onExternalClockAdjustedProxy =
      [this](const ExternalClockAdjustEvent &event) {
        emscripten::val changes = emscripten::val::object();
        if (event.bpm) {
          changes.set("bpm", event.bpm.value());
        }
        if (event.phase) {
          changes.set("phase", event.phase.value() + beatOffset_ * 2.0 * M_PI);
        }
        changes.set("timestamp", event.timestamp);
        std::string typeString;
        if (event.type == ExternalClockAdjustType::Sync) {
          typeString = "sync";
        } else if (event.type == ExternalClockAdjustType::Nudge) {
          typeString = "nudge";
        }
        changes.set("type", typeString);
        onExternalClockAdjusted_(changes);
      };

  auto onExternalClockDebugDataProxy =
      [this](const ExternalClockDebugData &data,
             const std::optional<ExternalClockAdjustEvent> &event) {
        emscripten::val externalClock = emscripten::val::object();
        externalClock.set("lastUpdateTime", data.lastUpdateTime);
        externalClock.set("bpm", data.bpm);
        externalClock.set("phase", data.phase + beatOffset_ * 2.0 * M_PI);
        externalClock.set("barPhase", data.barPhase + beatOffset_);
        if (data.scheduledBpmCorrection.has_value()) {
          emscripten::val correction = emscripten::val::object();
          correction.set("time", data.scheduledBpmCorrection.value().time);
          correction.set("bpm", data.scheduledBpmCorrection.value().bpm);
          correction.set("scheduledAt",
                         data.scheduledBpmCorrection.value().scheduledAt);
          externalClock.set("scheduledBpmCorrection", correction);
        } else {
          externalClock.set("scheduledBpmCorrection", emscripten::val::null());
        }

        emscripten::val updates = emscripten::val::object();
        updates.set("externalClock", externalClock);

        if (event) {
          emscripten::val externalClockEvent = emscripten::val::object();
          if (event->bpm) {
            externalClockEvent.set("bpm", event->bpm.value());
          }
          if (event->phase) {
            externalClockEvent.set("phase", event->phase.value() +
                                                beatOffset_ * 2.0 * M_PI);
          }
          externalClockEvent.set("timestamp", event->timestamp);
          std::string typeString;
          if (event->type == ExternalClockAdjustType::Sync) {
            typeString = "sync";
          } else if (event->type == ExternalClockAdjustType::Nudge) {
            typeString = "nudge";
          }
          externalClockEvent.set("type", typeString);
          updates.set("externalClockEvent", externalClockEvent);
        }

        onDebugDataExported_(updates);
      };

  audioToClockCore_ = std::make_unique<AudioToClock>(
      config, onPredictionReadyProxy, onRequestFeatureExtractionProxy,
      onRequestBpmPhasePredictionProxy, onBestTrajectoryProxy,
      onStabilizerDebugDataProxy, onExternalClockAdjustedProxy,
      onExternalClockDebugDataProxy);

  onStatusUpdated_(std::string("AudioToClock WASM instance created"), false);
}

void AudioToClockWasm::addAudio(uintptr_t audioSamplesPtr, int numChannels,
                                int numSamples, double currentTime,
                                int inputSampleRate) {
  audioToClockCore_->addAudio(audioSamplesPtr, numChannels, numSamples,
                              currentTime, inputSampleRate);
}

void AudioToClockWasm::resolveFeatureExtractor(uintptr_t odfDataPtr,
                                               size_t odfLength,
                                               uintptr_t specDataPtr,
                                               size_t specLength) {
  audioToClockCore_->resolveFeatureExtractor(odfDataPtr, odfLength, specDataPtr,
                                             specLength);
}

void AudioToClockWasm::resolveBpmPhasePredictor(emscripten::val result) {
  BpmPhasePredictorResult res;
  res.bpm = result["bpm"].as<double>();
  res.phase = result["phase"].as<double>();
  res.phaseMagnitude = result["phaseMagnitude"].as<double>();
  res.inputTime = result["inputTime"].as<double>();
  res.phaseX = result["phaseX"].as<double>();
  res.phaseY = result["phaseY"].as<double>();
  audioToClockCore_->resolveBpmPhasePredictor(res);
}

void AudioToClockWasm::tick(double currentTime) {
  audioToClockCore_->tick(currentTime);
}

void AudioToClockWasm::resync(bool hard) {
  if (hard) {
    double currentBarPhase = audioToClockCore_->getBarPhase();
    beatOffset_ = -currentBarPhase;
  } else {
    audioToClockCore_->resync();
  }
}

void AudioToClockWasm::resetHardSync() { beatOffset_ = 0.0; }

void AudioToClockWasm::setForceExportAllDebugData(bool force) {
  audioToClockCore_->SetForceExportAllDebugData(force);
}

EMSCRIPTEN_BINDINGS(AudioToClockModule) {
  emscripten::class_<AudioToClockWasm>(
      "AudioToClock") // Bind the new wrapper class
      .constructor<emscripten::val, emscripten::val, emscripten::val,
                   emscripten::val, emscripten::val, emscripten::val>()
      .function("addAudio", &AudioToClockWasm::addAudio,
                emscripten::allow_raw_pointers())
      .function("tick", &AudioToClockWasm::tick)
      .function("resync", &AudioToClockWasm::resync)
      .function("resetHardSync", &AudioToClockWasm::resetHardSync)
      .function("setForceExportAllDebugData",
                &AudioToClockWasm::setForceExportAllDebugData)
      .function("resolveFeatureExtractor",
                &AudioToClockWasm::resolveFeatureExtractor,
                emscripten::allow_raw_pointers())
      .function("resolveBpmPhasePredictor",
                &AudioToClockWasm::resolveBpmPhasePredictor);
}