import { action, makeObservable, observable, runInAction, reaction } from 'mobx';
import { AudioToClockRunner } from '../beatsync/audio_to_clock_runner';
import { predictBarPhase } from '../beatsync/extrapolation';
import { DebugUpdates, InferenceManagerDebugData, StabilizerDebugData, ExternalClockDebugData, ExternalClockAdjustEvent } from '../beatsync/schema';
import { LocalController, SimpleMidiMapping } from '../builder/local-state';
import { midiManager } from '../io/midi/manager';

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
  public get localControllerInstance() { return this.localController; }

  private audioContext?: AudioContext;
  private audioCaptureNode: AudioNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private audioToClock?: AudioToClockRunner;

  // Resolume Integration
  // Logic moved to ExecutorWorker, but we configure it via LocalSettings

  constructor(
    private localController: LocalController,
    private connectToExecutor: (port: MessagePort) => void,
    private onResolumeSettingsChanged: (enabled: boolean) => void
  ) {
    makeObservable(this);

    // Auto-start after delay
    setTimeout(() => {
      this.initialize();
    }, 1000);
  }

  private initialize() {
    this.loadingMessage = 'Loading models...';

    // Create channel for worker-to-worker communication
    const channel = new MessageChannel();
    // Pass port1 to Executor (via RuntimeManager callback)
    if (this.connectToExecutor) {
      this.connectToExecutor(channel.port1);
    }
    // Port2 will be passed to AudioToClockRunner below

    const initialEnabled = this.localController.observableState.localSettings.beatSyncResolumeControlEnabled;
    this.onResolumeSettingsChanged(initialEnabled);

    this.setupMidiListener();

    this.audioToClock = new AudioToClockRunner({
      featureExtractorUrl: 'models/mel25/feature_extractor_fp32.onnx',
      bpmPhaseModelUrl: 'models/mel25/main_model_fp32.onnx',
      stabilizerConfig: {
        // For sidebar BPM visualization.
        exportDebugData: true,
      },
      externalClockControllerConfig: {
        // For sidebar icon visualization.
        // FIXME: Also used to determine when we get a zero crossing, to hit Resolume "resync".
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
            // BPM Forwarding moved to worker
          }
        });
      },
      onDebugDataExported: (updates) => this.handleDebugData(updates),
    });

    // Pass Port2 to Runner
    this.audioToClock.connectEventPort(channel.port2);

    this.audioContext = new AudioContext();

    // Preload worklet module to prevent race conditions during switching
    const workletUrl = new URL('../beatsync/audio-capture.worklet.ts', import.meta.url).toString();
    this.audioContext.audioWorklet.addModule(workletUrl).then(async () => {
      await this.enumerateDevices();

      // Auto-connect if allowed and previously selected
      const savedId = this.localController.observableState.localSettings.beatSyncAudioDeviceId;

      // Validate if the saved device still exists
      const deviceExists = this.audioDevices.some(d => d.deviceId === savedId);

      if (savedId && deviceExists) {
        await this.startMic(savedId);
      } else if (savedId) {
        console.warn(`[BeatSync] Saved audio device ${savedId} not found. Auto-connect validation failed.`);
        // Optionally fallback to default? For now, we respect the user's specific choice and do nothing if missing.
      }
    }).catch(err => {
      console.error("Failed to load audio worklet module", err);
    });
  }

  @action
  public setDebugDataEnabled(enabled: boolean) {
    this.debugDataEnabled = enabled;
    this.audioToClock?.setForceExportAllDebugData(enabled);
  }

  public get isHardSync(): boolean {
    return this.localController.observableState.localSettings.beatSyncHardSyncEnabled;
  }

  @action
  public setHardSync(hard: boolean) {
    this.localController.observableState.localSettings.beatSyncHardSyncEnabled = hard;
    this.localController.saveSettings();
  }

  public resync() {
    this.audioToClock?.resync(this.isHardSync);
  }

  @action
  public setResolumeControlEnabled(enabled: boolean) {
    this.localController.observableState.localSettings.beatSyncResolumeControlEnabled = enabled;
    this.localController.saveSettings();
    this.onResolumeSettingsChanged(enabled);
  }

  // MIDI Mapping
  @observable isMidiMappingActive = false;

  public get midiMapping(): SimpleMidiMapping | null {
    return this.localController.observableState.localSettings.beatSyncResyncMidiMapping;
  }

  @action
  public toggleMidiDoLearn() {
    this.isMidiMappingActive = !this.isMidiMappingActive;
  }

  @action
  public clearMidiMapping() {
    this.localController.observableState.localSettings.beatSyncResyncMidiMapping = null;
    this.localController.saveSettings();
    this.isMidiMappingActive = false;
  }

  private midiListenerDisposer: (() => void) | null = null;

  private setupMidiListener() {
    this.midiListenerDisposer = midiManager.onMidiEvent((event) => {
      // LEARNING MODE
      if (this.isMidiMappingActive) {
        runInAction(() => {
          // Determine type
          let mapping: SimpleMidiMapping | null = null;
          if (event.type === 'note_on') {
            mapping = { channel: event.channel, type: 'note', index: event.note };
          } else if (event.type === 'cc') {
            mapping = { channel: event.channel, type: 'cc', index: event.cc };
          }

          if (mapping) {
            this.localController.observableState.localSettings.beatSyncResyncMidiMapping = mapping;
            this.localController.saveSettings();
            this.isMidiMappingActive = false; // Disarm
          }
        });
        return;
      }

      // TRIGGER MODE
      const mapping = this.midiMapping;
      if (!mapping) return;

      let match = false;
      // Check if event matches mapping
      if (mapping.type === 'note' && event.type === 'note_on') {
        if (event.channel === mapping.channel && event.note === mapping.index) {
          match = true;
        }
      } else if (mapping.type === 'cc' && event.type === 'cc') {
        if (event.channel === mapping.channel && event.cc === mapping.index) {
          // For CC, trigger on value > 0 (assuming button release is 0)
          if (event.value > 0) {
            match = true;
          }
        }
      }

      if (match) {
        this.resync(); // Use existing resync logic (respects hard/soft setting)
      }
    });
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

      // Resolume Control Logic MOVED TO WORKER
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
      this.audioContext.resume().catch(e => console.warn("[BeatSync] Auto-resume failed (waiting for gesture):", e));
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
    this.audioToClock?.setRunning(false);

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

    // Module is preloaded in initialize()

    const workletNode = new AudioWorkletNode(this.audioContext, 'audio-capture-processor');
    const channel = new MessageChannel();

    // Send one port to the worklet
    workletNode.port.postMessage({
      type: 'init',
      port: channel.port1
    }, [channel.port1]);

    // Send the other port to the worker
    this.audioToClock?.connectAudioPort(channel.port2);

    // Keep the audio capture node reference (now worklet) so we can disconnect it
    // We were using ScriptProcessorNode type, need to update it to AudioNode
    this.audioCaptureNode = workletNode;

    // Connect source to worklet (worklet processes audio)
    source.connect(workletNode);
    // Connect to destination to ensure the worklet is processed by the audio engine
    // even if it just duplicates input or processes silently.
    workletNode.connect(this.audioContext.destination);

    // Note: rollingWaveformBuffer is no longer updated here as processing moved to worker.
    // If waveform visualization is needed later, we can add a separate AnalyserNode.
    this.audioToClock?.setRunning(true);
  }

  public async resumeAudio() {
    if (this.audioContext?.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.warn("[BeatSync] Resume failed:", e);
      }
    }
  }

  public dispose() {
    this.stopMic();
    this.audioContext?.close();
  }
}
