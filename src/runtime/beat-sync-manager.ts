import { action, makeObservable, observable, runInAction } from 'mobx';
import { AudioToClockRunner } from '../beatsync/audio_to_clock_runner';
import { predictBarPhase } from '../beatsync/extrapolation';
import { DebugUpdates, InferenceManagerDebugData, StabilizerDebugData, ExternalClockDebugData, ExternalClockAdjustEvent } from '../beatsync/schema';
import { LocalController } from '../builder/local-state';

export class BeatSyncManager {
  @observable loadingMessage = 'Waiting to initialize...';
  @observable predictedBpm: number = 0;
  @observable bestBpm: number = 0;
  @observable bestBarPhase: number = 0;
  @observable externalBpm: number = 0;
  @observable audioDevices: MediaDeviceInfo[] = [];
  @observable isMicActive = false;
  @observable selectedDeviceId: string | null = null;
  @observable overallConfidence: number = 0;
  @observable bestTrajectoryWeight: number = 0;
  @observable bpmVariance: number = 0;
  @observable debugDataEnabled = false;

  @observable displayQuantizedBeat: number = 0;

  @observable.ref lastInferenceUpdate: InferenceManagerDebugData | null = null;
  @observable.ref lastStabilizerUpdate: StabilizerDebugData | null = null;
  @observable.ref lastExternalClockUpdate: ExternalClockDebugData | null = null;
  @observable.ref lastExternalClockEvent: ExternalClockAdjustEvent | null = null;

  @observable rollingWaveformBuffer: Float32Array | null = null;

  public get audioContextInstance() { return this.audioContext; }

  private audioContext?: AudioContext;
  private audioCaptureNode: ScriptProcessorNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private audioToClock?: AudioToClockRunner;

  constructor(private localController: LocalController) {
    makeObservable(this);

    // Auto-start after delay
    setTimeout(() => {
      this.initialize();
    }, 1000);
  }

  private initialize() {
    this.loadingMessage = 'Loading models...';

    this.audioToClock = new AudioToClockRunner({
      featureExtractorUrl: 'models/mel25/feature_extractor_fp32.onnx',
      bpmPhaseModelUrl: 'models/mel25/main_model_fp32.onnx',
      externalClockControllerConfig: {
        // For global bar phase.
        exportDebugData: true,
      },
      exportAllDebugData: this.debugDataEnabled,
      onStatusUpdated: (status) => {
        runInAction(() => {
          this.loadingMessage = status.message;
        });
      },
      onExternalClockAdjusted: (changes) => {
        runInAction(() => {
          if (changes.bpm) {
            this.externalBpm = changes.bpm;
          }
        });
      },
      onDebugDataExported: (updates) => this.handleDebugData(updates),
    });

    this.audioContext = new AudioContext();
    this.enumerateDevices();

    // Auto-connect if allowed and previously selected
    const savedId = this.localController.observableState.localSettings.beatSyncAudioDeviceId;
    if (savedId) {
      this.startMic(savedId);
    }
  }

  @action
  public setDebugDataEnabled(enabled: boolean) {
    this.debugDataEnabled = enabled;
    this.audioToClock?.setForceExportAllDebugData(enabled);
  }

  @action
  private handleDebugData(updates: DebugUpdates) {
    if (updates.inference) {
      this.predictedBpm = updates.inference.bpm;
      this.lastInferenceUpdate = updates.inference;
    }
    if (updates.stabilizer) {
      this.lastStabilizerUpdate = updates.stabilizer;
      const bestTraj = updates.stabilizer.bestTrajectory;
      if (bestTraj) {
        this.bestBpm = bestTraj.bpm;
        this.bestBarPhase = bestTraj.barPhase;
      }
      this.bpmVariance = updates.stabilizer.bpmVariance;
      this.bestTrajectoryWeight = bestTraj ? bestTraj.weight : 0;
    }
    if (updates.externalClock) {
      this.lastExternalClockUpdate = updates.externalClock;
      const now = this.audioContext?.currentTime || 0;
      const barPhase = predictBarPhase(updates.externalClock, now);
      this.displayQuantizedBeat = Math.floor(barPhase) % 4;
    }
    if (updates.externalClockEvent) {
      this.lastExternalClockEvent = updates.externalClockEvent;
    }
  }

  @action
  public async enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      runInAction(() => {
        this.audioDevices = devices.filter(d => d.kind === 'audioinput' && d.deviceId);
      });
    } catch (e) {
      console.error("Error enumerating devices", e);
    }
  }

  @action
  public async requestPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      await this.enumerateDevices();
    } catch (err) {
      console.error('Permission denied or error:', err);
      runInAction(() => {
        this.loadingMessage = 'Permission denied. Please allow microphone access.';
      });
    }
  }

  @action
  public async startMic(deviceId: string) {
    if (this.selectedDeviceId === deviceId && this.isMicActive) {
      await this.stopMic();
      return;
    }

    if (this.isMicActive) {
      await this.stopMic();
    }

    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }

    try {
      // Try exact constraint first
      const constraints = { audio: { deviceId: { exact: deviceId } } };
      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn('Exact deviceId constraint failed, trying ideal...', err);
      try {
        const constraints = { audio: { deviceId: deviceId } };
        this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (retryErr) {
        console.error('Error accessing microphone:', retryErr);
        runInAction(() => {
          this.loadingMessage = 'Error accessing microphone.';
        });
        return;
      }
    }

    runInAction(() => {
      this.isMicActive = true;
      this.selectedDeviceId = deviceId;
      // Save to settings
      this.localController.observableState.localSettings.beatSyncAudioDeviceId = deviceId;
      this.localController.saveSettings();
    });

    this.setupAudioGraph(this.micStream);
  }

  @action
  public async stopMic() {
    this.micStream?.getTracks().forEach(track => track.stop());
    this.micSource?.disconnect();
    this.audioCaptureNode?.disconnect();

    this.micStream = null;
    this.micSource = null;
    this.audioCaptureNode = null;

    runInAction(() => {
      this.isMicActive = false;
      this.selectedDeviceId = null;
      this.rollingWaveformBuffer = null;
      this.localController.observableState.localSettings.beatSyncAudioDeviceId = null;
      this.localController.saveSettings();
    });
  }

  private setupAudioGraph(sourceElement: MediaStream) {
    if (!this.audioContext) return;

    this.micSource = this.audioContext.createMediaStreamSource(sourceElement);
    const source = this.micSource;

    this.audioCaptureNode = this.audioContext.createScriptProcessor(1024, 1, 1);

    this.audioCaptureNode.onaudioprocess = (audioProcessingEvent) => {
      if (!this.isMicActive) {
        return;
      }
      const inputBuffer = audioProcessingEvent.inputBuffer;
      const channelData = [];
      for (let i = 0; i < inputBuffer.numberOfChannels; i++) {
        channelData.push(inputBuffer.getChannelData(i));
      }
      this.audioToClock?.addAudio(channelData, this.audioContext?.currentTime ?? 0.0, this.audioContext?.sampleRate ?? 0);

      const inputData = inputBuffer.getChannelData(0);

      // Update observable buffer less frequently?
      // For now, let's just do logic here but update observable in a way that doesn't kill MobX
      // Actually, updating the observable array 40 times a second might be heavy.
      // But the Visualizer observes it.

      if (!this.rollingWaveformBuffer) {
        runInAction(() => {
          this.rollingWaveformBuffer = new Float32Array(this.audioContext?.sampleRate ?? 44100);
        });
      }

      const buffer = this.rollingWaveformBuffer!;
      const bufferLength = buffer.length;
      const newLength = inputData.length;
      buffer.copyWithin(0, newLength);
      buffer.set(inputData, bufferLength - newLength);

      // Trigger update? MobX arrays observe deep changes?
      // Float32Array is not observable by default in the same way.
      // We might need to toggle a 'version' observable or replace the reference.
      // Reference replacement is safer for raw buffers.
      // But re-allocating every frame is bad.
      // Let's rely on the View accessing the buffer directly if it's a reference,
      // but we need a signal that it updated.
      // For now, let's assuming the view is running a RAF loop and polling this buffer.
    };

    source.connect(this.audioCaptureNode);
    this.audioCaptureNode.connect(this.audioContext.destination);
  }

  public dispose() {
    this.stopMic();
    this.audioContext?.close();
  }
}
