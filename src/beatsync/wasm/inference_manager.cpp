#include "inference_manager.h"
#include "audio_utils.h"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <vector>

InferenceManager::InferenceManager(
    const InferenceManagerConfig &config,
    std::function<void(const BpmPhasePredictorResult &,
                       const InferenceManagerDebugData &)>
        onPrediction,
    std::function<void(const std::vector<float> &)> requestFeatureExtractor,
    std::function<void(const std::vector<float> &, const std::vector<float> &,
                       double)>
        requestBpmPhasePredictor)
    : config_(config), onPrediction_(onPrediction),
      requestFeatureExtractor_(requestFeatureExtractor),
      requestBpmPhasePredictor_(requestBpmPhasePredictor),
      resampler_(0, config.targetSampleRate) {
  debugData_ = {0, 120.0, 0.0, 0.0, 0.0, 0.0};
  odfWindow_.resize(config_.odfFrames * ODF_CHANNELS, 0.0f);
  specWindow_.resize(config_.specFrames * SPEC_CHANNELS, 0.0f);
}

void InferenceManager::addAudio(const std::vector<std::vector<float>> &channels,
                                double currentTime, int inputSampleRate) {
  if (resampler_.getInputSampleRate() != inputSampleRate) {
    resampler_ = Resampler(inputSampleRate, config_.targetSampleRate);
  }
  std::vector<float> monoData = downmix(channels);
  resampler_.addData(monoData);
  std::vector<double> resampled = resampler_.resample();

  if (resampled.empty()) {
    return;
  }

  if (!audioBlocks_.empty()) {
    const auto &lastBlock = audioBlocks_.back();
    double expectedTime =
        lastBlock.timestamp +
        lastBlock.data.size() / (double)config_.targetSampleRate;
    if (std::abs(currentTime - expectedTime) > 0.1) {
      audioBlocks_.clear();
      std::fill(odfWindow_.begin(), odfWindow_.end(), 0.0f);
      std::fill(specWindow_.begin(), specWindow_.end(), 0.0f);
      hopCounter_ = 0;
      resampler_.reset();
    }
  }

  audioBlocks_.push_back({resampled, currentTime});
  if (audioBlocks_.size() > MAX_QUEUED_BLOCKS) {
    audioBlocks_.erase(audioBlocks_.begin(),
                       audioBlocks_.begin() +
                           (audioBlocks_.size() - MAX_QUEUED_BLOCKS));
  }
}

void InferenceManager::process() {
  if (state_ != State::Idle) {
    return; // Already processing
  }

  size_t totalSamples = 0;
  for (const auto &block : audioBlocks_) {
    totalSamples += block.data.size();
  }

  int lookbehindSamples = config_.lookbehindSamples;
  int hopSamples = config_.hopSamples;
  numHopsToProcess_ = ((int)totalSamples - lookbehindSamples) / hopSamples;
  if (numHopsToProcess_ <= 0) {
    return; // Not enough audio
  }

  if (numHopsToProcess_ > config_.maxHopsPerStep) {
    int hopsToDiscard = numHopsToProcess_ - config_.maxHopsPerStep;
    consumeAudio(hopsToDiscard * hopSamples);
    numHopsToProcess_ = config_.maxHopsPerStep;
  }

  pending_chunk_ =
      getAudioChunk(numHopsToProcess_ * hopSamples + lookbehindSamples);
  consumeAudio(numHopsToProcess_ * hopSamples);

  std::vector<float> float_chunk_data(pending_chunk_.data.begin(),
                                      pending_chunk_.data.end());

  state_ = State::ExpectingFeatures;
  requestFeatureExtractor_(float_chunk_data);
}

void InferenceManager::onFeaturesReady(const FeatureExtractorResult &features) {
  // assert(state_ == State::ExpectingFeatures);
  features_ = features;
  currentHop_ = 0;
  processHops();
}

void InferenceManager::processHops() {
  const auto &planar_features = features_;
  const size_t odf_frames_wide = planar_features.odf.size() / ODF_CHANNELS;
  const size_t spec_frames_wide = planar_features.spec.size() / SPEC_CHANNELS;

  const int lookbehindSamples = config_.lookbehindSamples;
  const int lookbehindOdfFrames =
      std::floor(lookbehindSamples / HI_RES_HOP_LENGTH);
  const int lookbehindSpecFrames =
      std::floor(lookbehindSamples / LOW_RES_HOP_LENGTH);
  const double hopTime = config_.hopSamples / (double)config_.targetSampleRate;

  for (int i = currentHop_; i < numHopsToProcess_; ++i) {
    currentHop_ = i;
    const int odfFramesFor_i_hops =
        std::floor(i * config_.hopSamples / HI_RES_HOP_LENGTH);
    const int odfFramesFor_i_plus_1_hops =
        std::floor((i + 1) * config_.hopSamples / HI_RES_HOP_LENGTH);
    const int hopOdfFramesCount =
        odfFramesFor_i_plus_1_hops - odfFramesFor_i_hops;

    const int specFramesFor_i_hops =
        std::floor(i * config_.hopSamples / LOW_RES_HOP_LENGTH);
    const int specFramesFor_i_plus_1_hops =
        std::floor((i + 1) * config_.hopSamples / LOW_RES_HOP_LENGTH);
    const int hopSpecFramesCount =
        specFramesFor_i_plus_1_hops - specFramesFor_i_hops;

    if (hopOdfFramesCount > 0) {
      std::vector<float> newOdfWindow(odfWindow_.size());
      const int odfFrameStart = lookbehindOdfFrames + odfFramesFor_i_hops;
      for (int b = 0; b < ODF_CHANNELS; ++b) {
        const float *oldBand = odfWindow_.data() + b * config_.odfFrames;
        const float *newFrames =
            planar_features.odf.data() + b * odf_frames_wide + odfFrameStart;
        float *newBand = newOdfWindow.data() + b * config_.odfFrames;
        std::copy(oldBand + hopOdfFramesCount, oldBand + config_.odfFrames,
                  newBand);
        std::copy(newFrames, newFrames + hopOdfFramesCount,
                  newBand + config_.odfFrames - hopOdfFramesCount);
      }
      odfWindow_ = newOdfWindow;
    }

    if (hopSpecFramesCount > 0) {
      std::vector<float> newSpecWindow(specWindow_.size());
      const int specFrameStart = lookbehindSpecFrames + specFramesFor_i_hops;
      for (int b = 0; b < SPEC_CHANNELS; ++b) {
        const float *oldBand = specWindow_.data() + b * config_.specFrames;
        const float *newFrames =
            planar_features.spec.data() + b * spec_frames_wide + specFrameStart;
        float *newBand = newSpecWindow.data() + b * config_.specFrames;
        std::copy(oldBand + hopSpecFramesCount, oldBand + config_.specFrames,
                  newBand);
        std::copy(newFrames, newFrames + hopSpecFramesCount,
                  newBand + config_.specFrames - hopSpecFramesCount);
      }
      specWindow_ = newSpecWindow;
    }

    doExportDebugData();
    hopCounter_++;

    if (hopCounter_ % config_.inferenceInterval == 0) {
      std::vector<float> specInput;
      const float specSliceFraction = config_.specSliceFraction;
      if (specSliceFraction < 1.0) {
        const size_t originalFrames = config_.specFrames;
        const size_t slicedFrames = floor(originalFrames * specSliceFraction);
        if (slicedFrames < originalFrames) {
          specInput.resize(SPEC_CHANNELS * slicedFrames);
          for (int j = 0; j < SPEC_CHANNELS; ++j) {
            const float *channel_start =
                specWindow_.data() + j * originalFrames;
            const float *slice_start =
                channel_start + (originalFrames - slicedFrames);
            float *dest_start = specInput.data() + j * slicedFrames;
            std::copy(slice_start, slice_start + slicedFrames, dest_start);
          }
        } else {
          specInput = specWindow_;
        }
      } else {
        specInput = specWindow_;
      }

      double predictionTime =
          pending_chunk_.timestamp + i * hopTime - config_.delayCompensation -
          config_.lookbehindSamples / (double)config_.targetSampleRate;

      state_ = State::ExpectingPrediction;
      requestBpmPhasePredictor_(odfWindow_, specInput, predictionTime);
      return; // Wait for prediction
    }
  }

  state_ = State::Idle;
  process();
}

void InferenceManager::onPredictionReady(
    const BpmPhasePredictorResult &result) {
  // assert(state_ == State::ExpectingPrediction);

  // assert(state_ == State::ExpectingPrediction);

  if (this->config_.exportDebugData || forceExportAllDebugData_) {
    debugData_.inputTime = result.inputTime;
    debugData_.bpm = result.bpm;
    debugData_.phase = result.phase;
    debugData_.phaseMagnitude = result.phaseMagnitude;
    debugData_.phaseX = result.phaseX;
    debugData_.phaseY = result.phaseY;
  }
  onPrediction_(result, debugData_);

  currentHop_++;
  processHops();
}

AudioBlock InferenceManager::getAudioChunk(size_t numSamples) {
  if (audioBlocks_.empty()) {
    return {{}, 0};
  }
  double timestamp = audioBlocks_[0].timestamp;
  std::vector<double> audioChunk;
  audioChunk.reserve(numSamples);

  size_t samplesCopied = 0;
  for (const auto &block : audioBlocks_) {
    size_t samplesToCopy =
        std::min(numSamples - samplesCopied, block.data.size());
    audioChunk.insert(audioChunk.end(), block.data.begin(),
                      block.data.begin() + samplesToCopy);
    samplesCopied += samplesToCopy;
    if (samplesCopied == numSamples) {
      break;
    }
  }
  return {audioChunk, timestamp};
}

void InferenceManager::consumeAudio(size_t numSamples) {
  size_t samplesToConsume = numSamples;
  while (samplesToConsume > 0 && !audioBlocks_.empty()) {
    auto &block = audioBlocks_.front();
    if (samplesToConsume >= block.data.size()) {
      samplesToConsume -= block.data.size();
      audioBlocks_.erase(audioBlocks_.begin());
    } else {
      block.data.erase(block.data.begin(),
                       block.data.begin() + samplesToConsume);
      block.timestamp += samplesToConsume / (double)config_.targetSampleRate;
      samplesToConsume = 0;
    }
  }
}

void InferenceManager::SetForceExportAllDebugData(bool forceExport) {
  forceExportAllDebugData_ = forceExport;
}

void InferenceManager::doExportDebugData() {
  if (this->config_.exportDebugData || forceExportAllDebugData_) {
    if (this->odfWindow_.size() >= (config_.odfFrames * ODF_CHANNELS)) {
      const size_t odfFrames = this->config_.odfFrames;
      this->debugData_.odfWindow.clear();
      this->debugData_.odfWindow.resize(ODF_CHANNELS);
      for (auto &v : this->debugData_.odfWindow) {
        v.resize(odfFrames);
      }

      for (int i = 0; i < ODF_CHANNELS; ++i) {
        for (int j = 0; j < odfFrames; ++j) {
          this->debugData_.odfWindow[i][j] =
              this->odfWindow_[i * odfFrames + j];
        }
      }
    }

    if (this->specWindow_.size() >= (config_.specFrames * SPEC_CHANNELS)) {
      const size_t specFrames = this->config_.specFrames;
      this->debugData_.specWindow.clear();
      this->debugData_.specWindow.resize(SPEC_CHANNELS);
      for (auto &v : this->debugData_.specWindow) {
        v.resize(specFrames);
      }

      for (int i = 0; i < SPEC_CHANNELS; ++i) {
        for (int j = 0; j < specFrames; ++j) {
          this->debugData_.specWindow[i][j] =
              this->specWindow_[i * specFrames + j];
        }
      }
    }
  }
}
