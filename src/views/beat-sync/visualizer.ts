
import { InferenceManagerDebugData } from '../../beatsync/schema';
import { StabilizerDebugData, StabilizerTrajectory } from "../../beatsync/schema";
import { ExternalClockAdjustType, ExternalClockDebugData } from "../../beatsync/schema";
import { predictBarPhase, predictPhase } from '../../beatsync/extrapolation';

const BPM_GRAPH_RANGE = 6.0;
const BPM_GRAPH_CENTER_STEP = 1.0;
const BPM_GRAPH_CENTER_THRESHOLD = 2.5;
const PRED_HISTORY_LENGTH = 600;
const GRAPH_HISTORY_SECONDS = 5;
const GRAPH_FUTURE_SECONDS = 5;
const BLOCK_DURATION_S = 5.0;

export interface VisualizerCanvases {
  mainWaveformCanvas: HTMLCanvasElement;
  odfCanvas: HTMLCanvasElement;
  specCanvas: HTMLCanvasElement;
  phaseClockCanvas: HTMLCanvasElement;
  barClockCanvas: HTMLCanvasElement;
  trajectoryClockCanvas: HTMLCanvasElement;
  bpmGraphCanvas: HTMLCanvasElement;
  phaseGraphCanvas: HTMLCanvasElement;
}

export class BeatSyncVisualizer {
  private canvases: VisualizerCanvases;
  private audioContext?: AudioContext;

  private rollingWaveformBuffer: Float32Array | null = null;
  private externalClockSample: ExternalClockDebugData | null = null;
  private stabilizerSample: StabilizerDebugData | null = null;
  private inferenceSample: InferenceManagerDebugData | null = null;

  private latestPhase: number = 0;
  private latestBpm: number = 0;
  private latestMagnitude: number = 0;
  private lastPredictionTime: number = 0;

  private readonly phaseHistory: { value: number, timestamp: number }[] = [];
  private readonly bpmHistory: { value: number, timestamp: number }[] = [];
  private readonly bestTrajPhaseHistory: { value: number, timestamp: number }[] = [];
  private readonly externalClockHistory: { bpm: number, phase: number, timestamp: number, type: ExternalClockAdjustType }[] = [];

  private lastPhase: number = 0;
  private lastBarPhase: number = 0;
  private phaseMarkPassTime: number = -1;
  private readonly barMarkPassTime: number[] = [-1, -1, -1, -1];
  private lastBestTrajectoryId: number = -1;
  private trajectorySwitchTime: number = -1;
  private lastBestTrajectoryPhase: number = 0;
  private trajectoryMarkPassTime: number = -1;

  private bpmGraphPrevBpmCenter: number = 120;

  get bpmGraphCenterBpm() {
    return this.bpmGraphPrevBpmCenter;
  }

  get hasAudioContext() {
    return !!this.audioContext;
  }

  constructor(canvases: VisualizerCanvases, audioContext?: AudioContext) {
    this.canvases = canvases;
    this.audioContext = audioContext;
  }

  setAudioContext(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  updateExternalClock(sample: ExternalClockDebugData) {
    this.externalClockSample = sample;
  }

  updateStabilizer(sample: StabilizerDebugData) {
    this.stabilizerSample = sample;
  }

  updateInference(sample: InferenceManagerDebugData) {
    this.inferenceSample = sample;
    this.latestPhase = sample.phase;
    this.latestBpm = sample.bpm;
    this.latestMagnitude = sample.phaseMagnitude;
    this.lastPredictionTime = sample.inputTime;
  }

  updateRollingWaveform(buffer: Float32Array) {
    this.rollingWaveformBuffer = buffer;
  }

  addExternalClockHistory(sample: { bpm?: number, phase?: number, timestamp: number, type: ExternalClockAdjustType }) {
    const lastSample = this.externalClockHistory.at(-1);
    let currentPhase = sample.phase;
    let currentBpm = sample.bpm;
    if (sample.phase === undefined && lastSample) {
      const dt = sample.timestamp - lastSample.timestamp;
      const phaseAdvance = (dt * lastSample.bpm / 60.0) * 2 * Math.PI;
      currentPhase = lastSample.phase + phaseAdvance;
    }
    if (sample.bpm === undefined && lastSample) {
      currentBpm = lastSample.bpm;
    }
    currentPhase ??= 0.0;
    currentBpm ??= 120.0;
    this.externalClockHistory.push({ ...sample, bpm: currentBpm, phase: currentPhase });
    if (this.externalClockHistory.length > PRED_HISTORY_LENGTH) {
      this.externalClockHistory.shift();
    }
  }

  updateVisualizations(bestBpm: number, overallConfidence: number, bestTrajectoryWeight: number) {
    // Only draw if context exists
    if (!this.audioContext) return;

    if (this.canvases.mainWaveformCanvas && this.rollingWaveformBuffer) {
      this.drawWaveform(this.canvases.mainWaveformCanvas.getContext('2d')!, this.rollingWaveformBuffer, '#ff4500');
    }

    const odf = this.inferenceSample?.odfWindow;
    if (this.canvases.odfCanvas && odf) {
      this.drawOdf(this.canvases.odfCanvas.getContext('2d')!, odf);
    }

    const spec = this.inferenceSample?.specWindow;
    if (this.canvases.specCanvas && spec) {
      this.drawSpectrogram(this.canvases.specCanvas.getContext('2d')!, spec);
    }

    const currentTime = this.audioContext.currentTime;
    const timeSincePrediction = currentTime - this.lastPredictionTime;

    if (this.latestBpm > 0) {
      const ibi = 60.0 / this.latestBpm;
      const phaseAdvance = (timeSincePrediction / ibi) * 2 * Math.PI;

      let interpolatedPhase = this.latestPhase + phaseAdvance;
      interpolatedPhase = Math.atan2(Math.sin(interpolatedPhase), Math.cos(interpolatedPhase));

      if (this.lastPhase > 0 && interpolatedPhase <= 0) { // crossed 0
        this.phaseMarkPassTime = currentTime;
      }
      this.lastPhase = interpolatedPhase;

      this.phaseHistory.push({ value: interpolatedPhase, timestamp: currentTime });
      if (this.phaseHistory.length > PRED_HISTORY_LENGTH) {
        this.phaseHistory.shift();
      }

      if (this.canvases.phaseClockCanvas) {
        this.drawRawPhaseClock(interpolatedPhase, this.latestMagnitude, this.phaseHistory.map(p => p.value), currentTime);
      }
    }

    const trajectories = this.stabilizerSample?.trajectories ?? [];
    const bestTraj = this.stabilizerSample?.bestTrajectory ?? null;
    if (bestTraj && bestTraj.id !== this.lastBestTrajectoryId) {
      this.trajectorySwitchTime = currentTime;
      this.lastBestTrajectoryId = bestTraj.id;
      this.lastBestTrajectoryPhase = 0;
    }

    if (this.canvases.trajectoryClockCanvas) {
      this.drawTrajectories(this.canvases.trajectoryClockCanvas.getContext('2d')!, trajectories, bestTraj, currentTime);
    }

    if (bestTraj) {
      this.bpmHistory.push({ value: bestBpm, timestamp: currentTime });
      if (this.bpmHistory.length > PRED_HISTORY_LENGTH) {
        this.bpmHistory.shift();
      }

      const barPhase = this.externalClockSample ? predictBarPhase(this.externalClockSample, currentTime) : 0.0;
      const currentBeat = (Math.floor(barPhase) % 4 + 4) % 4;
      const lastBeat = Math.floor(this.lastBarPhase) % 4;

      const bestTrajPhase = predictPhase(bestTraj, currentTime);
      const bestTrajBarPhase = predictBarPhase(bestTraj, currentTime);

      if (currentBeat !== lastBeat) {
        this.barMarkPassTime[currentBeat] = currentTime;
      }

      if (this.canvases.barClockCanvas) {
        this.drawBarPhaseClock(barPhase, bestTrajBarPhase, currentTime);
      }
      this.lastBarPhase = barPhase;

      const lastCycle = Math.floor(this.lastBestTrajectoryPhase / (2 * Math.PI));
      const currentCycle = Math.floor(bestTrajPhase / (2 * Math.PI));
      if (currentCycle > lastCycle) {
        this.trajectoryMarkPassTime = currentTime;
      }
      this.lastBestTrajectoryPhase = bestTrajPhase;

      this.bestTrajPhaseHistory.push({ value: bestTrajPhase, timestamp: currentTime });
      if (this.bestTrajPhaseHistory.length > PRED_HISTORY_LENGTH) {
        this.bestTrajPhaseHistory.shift();
      }
    } else {
      if (this.canvases.barClockCanvas) {
        this.drawBarPhaseClock(0, 0, currentTime);
      }
      this.lastBarPhase = 0;
      this.lastBestTrajectoryPhase = 0;
    }

    if (this.canvases.bpmGraphCanvas) {
      this.drawBpmGraph(bestBpm);
    }
    if (this.canvases.phaseGraphCanvas) {
      this.drawPhaseGraph(bestTraj);
    }
  }

  drawBpmGraph(bestBpm: number) {
    const ctx = this.canvases.bpmGraphCanvas.getContext('2d')!;
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;

    // Draw center line
    ctx.strokeStyle = '#444';
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);
    ctx.stroke();

    const now = this.audioContext!.currentTime;

    // Use custom BPM range for display, centered around a stable center.
    const latestBpm = this.bpmHistory.at(-1)?.value ?? this.bpmGraphPrevBpmCenter;
    const latestBpmCenter = Math.round(latestBpm / BPM_GRAPH_CENTER_STEP) * BPM_GRAPH_CENTER_STEP;
    if (Math.abs(this.bpmGraphPrevBpmCenter - latestBpmCenter) > BPM_GRAPH_CENTER_THRESHOLD) {
      this.bpmGraphPrevBpmCenter = latestBpmCenter;
    }
    const bpmCenter = this.bpmGraphPrevBpmCenter;
    const bpmMin = bpmCenter - BPM_GRAPH_RANGE * 0.5;
    const bpmMax = bpmCenter + BPM_GRAPH_RANGE * 0.5;

    // Draw history
    if (this.bpmHistory.length > 0) {
      ctx.strokeStyle = '#1ed760';
      ctx.beginPath();
      let first = true;
      for (let i = this.bpmHistory.length - 1; i >= 0; i--) {
        const point = this.bpmHistory[i];
        const timeAgo = now - point.timestamp;
        if (timeAgo > GRAPH_HISTORY_SECONDS) break;

        const bpm = point.value;
        const normalizedBpm = (bpm - bpmMin) / (bpmMax - bpmMin);
        const x = centerX - (timeAgo / GRAPH_HISTORY_SECONDS) * centerX;
        const y = (1 - normalizedBpm) * canvas.height;

        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Draw external BPM history
    if (this.externalClockHistory.length > 0) {
      ctx.strokeStyle = '#ff00ff'; // Magenta for external clock
      ctx.beginPath();
      let prevY: number | undefined = undefined;
      for (let i = this.externalClockHistory.length - 1; i >= 0; i--) {
        const point = this.externalClockHistory[i];
        const timeAgo = now - point.timestamp;
        if (timeAgo > GRAPH_HISTORY_SECONDS) break;

        const bpm = point.bpm;
        const normalizedBpm = (bpm - bpmMin) / (bpmMax - bpmMin);
        const x = centerX - (timeAgo / GRAPH_HISTORY_SECONDS) * centerX;
        const y = (1 - normalizedBpm) * canvas.height;

        if (prevY === undefined) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, prevY);
          ctx.lineTo(x, y);
        }
        prevY = y;
      }

      // Extend the line to the center
      const lastPoint = this.externalClockHistory[this.externalClockHistory.length - 1];
      if (lastPoint) {
        const timeAgo = now - lastPoint.timestamp;
        const x = centerX - (timeAgo / GRAPH_HISTORY_SECONDS) * centerX;
        const normalizedBpm = (lastPoint.bpm - bpmMin) / (bpmMax - bpmMin);
        const y = (1 - normalizedBpm) * canvas.height;
        ctx.moveTo(x, y);
        ctx.lineTo(centerX, y);
      }
      ctx.stroke();
    }

    // Draw prediction
    if (bestBpm > 0) {
      const normalizedBpm = (bestBpm - bpmMin) / (bpmMax - bpmMin);
      const y = (1 - normalizedBpm) * canvas.height;
      ctx.strokeStyle = 'red';
      ctx.beginPath();
      ctx.moveTo(centerX, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw external BPM prediction
    const scheduledCorrection = this.externalClockSample?.scheduledBpmCorrection;
    if (this.externalClockSample && this.externalClockSample.bpm > 0) {
      ctx.strokeStyle = 'orange';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();

      const startY = (1 - (this.externalClockSample.bpm - bpmMin) / (bpmMax - bpmMin)) * canvas.height;
      ctx.moveTo(centerX, startY);

      if (scheduledCorrection) {
        const correctionTime = scheduledCorrection.time;
        const timeToCorrection = correctionTime - now;

        if (timeToCorrection > 0 && timeToCorrection < GRAPH_FUTURE_SECONDS) {
          const correctionX = centerX + (timeToCorrection / GRAPH_FUTURE_SECONDS) * centerX;
          ctx.lineTo(correctionX, startY);

          const futureBpm = scheduledCorrection.bpm;
          const futureY = (1 - (futureBpm - bpmMin) / (bpmMax - bpmMin)) * canvas.height;
          ctx.lineTo(correctionX, futureY);
          ctx.lineTo(canvas.width, futureY);

          // Draw vertical line
          ctx.stroke(); // stroke the prediction line
          ctx.strokeStyle = 'yellow';
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(correctionX, 0);
          ctx.lineTo(correctionX, canvas.height);
        } else {
          ctx.lineTo(canvas.width, startY);
        }
      } else {
        ctx.lineTo(canvas.width, startY);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw phase sync markers
    this.drawSyncMarkers(ctx, now);
  }

  drawPhaseGraph(bestTraj?: StabilizerTrajectory | null) {
    const ctx = this.canvases.phaseGraphCanvas.getContext('2d')!;
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;

    // Draw center line
    ctx.strokeStyle = '#444';
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);
    ctx.stroke();

    const now = this.audioContext!.currentTime;

    // Draw history
    if (this.bestTrajPhaseHistory.length > 0) {
      ctx.strokeStyle = '#1ed760';
      ctx.beginPath();
      let first = true;
      for (let i = this.bestTrajPhaseHistory.length - 1; i >= 0; i--) {
        const point = this.bestTrajPhaseHistory[i];
        const timeAgo = now - point.timestamp;
        if (timeAgo > GRAPH_HISTORY_SECONDS) break;

        const phase = point.value;
        const normalizedPhase = ((phase / (2 * Math.PI)) % 1.0 + 1.0) % 1.0;
        const x = centerX - (timeAgo / GRAPH_HISTORY_SECONDS) * centerX;
        const y = (1 - normalizedPhase) * canvas.height;

        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Draw external phase history
    if (this.externalClockHistory.length > 0) {
      ctx.strokeStyle = '#ff00ff'; // Magenta for external clock
      ctx.beginPath();

      let currentSampleIndex = 0;
      // Find the first sample that could be in view, or the one just before.
      for (let i = 0; i < this.externalClockHistory.length; i++) {
        if (now - this.externalClockHistory[i].timestamp < GRAPH_HISTORY_SECONDS) {
          currentSampleIndex = i > 0 ? i - 1 : 0;
          break;
        }
        currentSampleIndex = i;
      }

      let firstPoint = true;
      for (let x = 0; x < centerX; x++) {
        const timeAgo = (centerX - x) / centerX * GRAPH_HISTORY_SECONDS;
        const time = now - timeAgo;

        // Find the right sample for this time
        while (currentSampleIndex + 1 < this.externalClockHistory.length && this.externalClockHistory[currentSampleIndex + 1].timestamp <= time) {
          currentSampleIndex++;
        }
        const sample = this.externalClockHistory[currentSampleIndex];

        const timeSinceSample = time - sample.timestamp;
        const phaseAdvance = (timeSinceSample * sample.bpm / 60.0) * 2 * Math.PI;
        const predictedPhase = sample.phase + phaseAdvance;
        const normalizedPhase = ((predictedPhase / (2 * Math.PI)) % 1.0 + 1.0) % 1.0;
        const y = (1 - normalizedPhase) * canvas.height;

        if (firstPoint) {
          ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Draw external phase prediction
    const lastSample = this.externalClockHistory.at(-1);
    if (lastSample && this.externalClockSample) {
      ctx.strokeStyle = 'orange';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();

      const scheduledCorrection = this.externalClockSample.scheduledBpmCorrection;
      const correctionTime = scheduledCorrection?.time;
      const currentBpm = this.externalClockSample.bpm;

      const phaseAtNow = lastSample.phase + ((now - lastSample.timestamp) * lastSample.bpm / 60.0) * 2 * Math.PI;

      let first = true;
      for (let x = centerX; x < canvas.width; x++) {
        const timeOffset = (x - centerX) / centerX * GRAPH_FUTURE_SECONDS;
        const time = now + timeOffset;

        let phaseAdvance;
        if (correctionTime && time >= correctionTime) {
          const dt1 = correctionTime - now;
          const dt2 = time - correctionTime;
          phaseAdvance = (dt1 * currentBpm + dt2 * scheduledCorrection!.bpm) / 60.0 * 2 * Math.PI;
        } else {
          phaseAdvance = (timeOffset * currentBpm / 60.0) * 2 * Math.PI;
        }

        const predictedPhase = phaseAtNow + phaseAdvance;
        const normalizedPhase = ((predictedPhase / (2 * Math.PI)) % 1.0 + 1.0) % 1.0;
        const y = (1 - normalizedPhase) * canvas.height;

        if (first) {
          const normalizedPhaseNow = ((phaseAtNow / (2 * Math.PI)) % 1.0 + 1.0) % 1.0;
          const yNow = (1 - normalizedPhaseNow) * canvas.height;
          ctx.moveTo(centerX, yNow);
          first = false;
        }
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw vertical line for correction
      if (correctionTime) {
        const timeToCorrection = correctionTime - now;
        if (timeToCorrection > 0 && timeToCorrection < GRAPH_FUTURE_SECONDS) {
          const correctionX = centerX + (timeToCorrection / GRAPH_FUTURE_SECONDS) * centerX;
          ctx.strokeStyle = 'yellow';
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(correctionX, 0);
          ctx.lineTo(correctionX, canvas.height);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Draw best trajectory future phase
    if (bestTraj) {
      ctx.strokeStyle = '#1ed760'; // green
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      let first = true;
      for (let x = centerX; x < canvas.width; x++) {
        const timeOffset = (x - centerX) / centerX * GRAPH_FUTURE_SECONDS;
        const time = now + timeOffset;
        const phase = predictPhase(bestTraj, time);
        const normalizedPhase = ((phase / (2 * Math.PI)) % 1.0 + 1.0) % 1.0;
        const y = (1 - normalizedPhase) * canvas.height;
        if (first) {
          // move to the start of the future line, which is the end of the history line
          const phaseNow = predictPhase(bestTraj, now);
          const normalizedPhaseNow = ((phaseNow / (2 * Math.PI)) % 1.0 + 1.0) % 1.0;
          const yNow = (1 - normalizedPhaseNow) * canvas.height;
          ctx.moveTo(centerX, yNow);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw phase sync markers
    this.drawSyncMarkers(ctx, now);
  }

  drawSyncMarkers(ctx: CanvasRenderingContext2D, now: number) {
    const canvas = ctx.canvas;
    const centerX = canvas.width / 2;

    // Draw BPM adjustment markers
    ctx.fillStyle = 'yellow';
    for (const sample of this.externalClockHistory) {
      if (sample.type !== 'nudge') {
        continue;
      }
      const timeAgo = now - sample.timestamp;
      if (timeAgo >= 0 && timeAgo < GRAPH_HISTORY_SECONDS) {
        const x = centerX - (timeAgo / GRAPH_HISTORY_SECONDS) * centerX;
        ctx.beginPath();
        ctx.arc(x, canvas.height - 5, 5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Draw phase sync markers.
    ctx.fillStyle = 'cyan';
    for (const sample of this.externalClockHistory) {
      if (sample.type !== 'sync') {
        continue;
      }
      const timeAgo = now - sample.timestamp;
      if (timeAgo >= 0 && timeAgo < GRAPH_HISTORY_SECONDS) {
        const x = centerX - (timeAgo / GRAPH_HISTORY_SECONDS) * centerX;
        ctx.beginPath();
        ctx.arc(x, canvas.height - 5, 5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  drawBarPhaseClock(barPhase: number, bestTrajBarPhase: number, currentTime: number) {
    const ctx = this.canvases.barClockCanvas.getContext('2d')!;
    const canvas = ctx.canvas;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) * 0.9;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const timeSinceSwitch = currentTime - this.trajectorySwitchTime;
    let switchBrightness = 0;
    if (timeSinceSwitch >= 0 && timeSinceSwitch < 1.0) { // fade out over 1 second
      switchBrightness = 1.0 - timeSinceSwitch;
      switchBrightness = Math.pow(switchBrightness, 4.0);
    }

    // Draw clock face
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${20 * (1.0 - switchBrightness) + 255 * switchBrightness}, ${20 * (1.0 - switchBrightness) + 0}, ${20 * (1.0 - switchBrightness) + 0}, 1.0)`;
    ctx.lineWidth = 2;
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw hour marks for 4 beats
    const beatMarkWidth = Math.max(2, radius * 0.1);
    const beatMarkLength = radius * 0.3;
    const beatMarkFlashDuration = 1.5;
    const beatMarkFlashCurve = 8.0;
    ctx.lineWidth = beatMarkWidth;
    for (let i = 0; i < 4; i++) {
      const timeSincePass = currentTime - this.barMarkPassTime[i];
      let brightness = 0;
      if (timeSincePass >= 0 && timeSincePass < beatMarkFlashDuration) { // fade out over 1 second
        brightness = (beatMarkFlashDuration - timeSincePass) / beatMarkFlashDuration;
        brightness = Math.pow(brightness, beatMarkFlashCurve);
      }

      const angle = (i / 4) * 2 * Math.PI - Math.PI / 2;
      const x1 = centerX + radius * Math.cos(angle);
      const y1 = centerY + radius * Math.sin(angle);
      const x2 = centerX + (radius - beatMarkLength) * Math.cos(angle);
      const y2 = centerY + (radius - beatMarkLength) * Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${20 * (1.0 - brightness) + 0}, ${20 * (1.0 - brightness) + 255 * brightness}, ${20 * (1.0 - brightness) + 0}, ${0.5 + brightness * 0.5})`;
      ctx.stroke();
    }
    ctx.lineWidth = 2;

    // Draw hand
    const handLength = radius * 0.9;
    const bestTrajBarPhaseAngle = ((bestTrajBarPhase % 4.0) / 4.0) * 2 * Math.PI - Math.PI / 2;
    ctx.beginPath();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + handLength * Math.cos(bestTrajBarPhaseAngle), centerY + handLength * Math.sin(bestTrajBarPhaseAngle));
    ctx.stroke();

    const barPhaseAngle = ((barPhase % 4.0) / 4.0) * 2 * Math.PI - Math.PI / 2;
    ctx.beginPath();
    ctx.strokeStyle = '#ff00ff'; // Magenta for external clock
    ctx.lineWidth = 3;
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + handLength * Math.cos(barPhaseAngle), centerY + handLength * Math.sin(barPhaseAngle));
    ctx.stroke();
  }

  drawTrajectories(ctx: CanvasRenderingContext2D, trajectories: StabilizerTrajectory[], bestTrajectory: StabilizerTrajectory | null, currentTime: number) {
    const canvas = ctx.canvas;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) * 0.9;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const timeSinceSwitch = currentTime - this.trajectorySwitchTime;
    let brightness = 0;
    if (timeSinceSwitch >= 0 && timeSinceSwitch < 1.0) { // fade out over 1 second
      brightness = 1.0 - timeSinceSwitch;
      brightness = Math.pow(brightness, 4.0);
    }

    ctx.beginPath();
    ctx.strokeStyle = `rgba(${20 * (1.0 - brightness) + 255 * brightness}, ${20 * (1.0 - brightness) + 0}, ${20 * (1.0 - brightness) + 0}, 1.0)`;
    ctx.lineWidth = 2;
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    const timeSincePass = currentTime - this.trajectoryMarkPassTime;
    let flashBrightness = 0;
    const beatMarkFlashDuration = 1.5;
    const beatMarkFlashCurve = 8.0;
    if (timeSincePass >= 0 && timeSincePass < beatMarkFlashDuration) { // fade out over 1 second
      flashBrightness = (beatMarkFlashDuration - timeSincePass) / beatMarkFlashDuration;
      flashBrightness = Math.pow(flashBrightness, beatMarkFlashCurve);
    }

    ctx.beginPath();
    ctx.fillStyle = `rgba(${20 * (1.0 - flashBrightness) + 0}, ${20 * (1.0 - flashBrightness) + 255 * flashBrightness}, ${20 * (1.0 - flashBrightness) + 0}, ${0.5 + flashBrightness * 0.5})`;
    ctx.arc(centerX, centerY - radius, 5 + 15 * flashBrightness, 0, 2 * Math.PI);
    ctx.fill();

    trajectories.forEach(traj => {
      const isBest = bestTrajectory ? traj.id === bestTrajectory.id : false;
      const opacity = Math.min(1.0, 0.2 + (traj.weight / 10.0));
      ctx.strokeStyle = isBest ? `rgba(255, 0, 0, ${opacity})` : `rgba(255, 255, 255, ${opacity * 0.1 * Math.atan(traj.weight)})`;
      ctx.lineWidth = isBest ? 3 : 2;

      const handLength = radius * 0.9;
      const angle = predictPhase(traj, this.audioContext!.currentTime) - Math.PI / 2;
      const x = centerX + handLength * Math.cos(angle);
      const y = centerY + handLength * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
    });
  }

  drawRawPhaseClock(phase: number, magnitude: number, history: number[], currentTime: number) {
    const ctx = this.canvases.phaseClockCanvas.getContext('2d')!;
    const canvas = ctx.canvas;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) * 0.9;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const timeSinceSwitch = currentTime - this.trajectorySwitchTime;
    let switchBrightness = 0;
    if (timeSinceSwitch >= 0 && timeSinceSwitch < 1.0) { // fade out over 1 second
      switchBrightness = 1.0 - timeSinceSwitch;
      switchBrightness = Math.pow(switchBrightness, 4.0);
    }

    ctx.beginPath();
    ctx.strokeStyle = `rgba(${20 * (1.0 - switchBrightness) + 255 * switchBrightness}, ${20 * (1.0 - switchBrightness) + 0}, ${20 * (1.0 - switchBrightness) + 0}, 1.0)`;
    ctx.lineWidth = 2;
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    const timeSincePass = currentTime - this.phaseMarkPassTime;
    let brightness = 0;
    if (timeSincePass >= 0 && timeSincePass < 1.0) { // fade out over 1 second
      brightness = 1.0 - timeSincePass;
    }
    ctx.beginPath();
    ctx.fillStyle = `rgba(29, 185, 84, ${0.5 + brightness * 0.5})`;
    ctx.arc(centerX, centerY - radius, 5, 0, 2 * Math.PI);
    ctx.fill();

    // Draw shadows
    history.slice(-32).forEach((histPhase, index) => {
      if (index === history.length - 1) return; // Don't draw current as shadow

      const opacity = 0.1 + (index / history.length) * 0.4;
      ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.lineWidth = 2;

      const handLength = radius * 0.9;
      const angle = histPhase - Math.PI / 2;
      const x = centerX + handLength * Math.cos(angle);
      const y = centerY + handLength * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
    });

    // Draw current hand
    const handLength = radius * 0.9;
    const angle = phase - Math.PI / 2;
    const x = centerX + handLength * Math.cos(angle);
    const y = centerY + handLength * Math.sin(angle);
    ctx.beginPath();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x, y);
    ctx.stroke();

    const magRadius = magnitude * radius;
    ctx.beginPath();
    ctx.strokeStyle = '#1ed760';
    ctx.lineWidth = 2;
    ctx.arc(centerX, centerY, magRadius, 0, 2 * Math.PI);
    ctx.stroke();
  }

  drawOdf(ctx: CanvasRenderingContext2D, odfBands: Float32Array[]) {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!odfBands || odfBands.length === 0) return;

    const numBands = odfBands.length;
    const numFrames = odfBands[0].length;

    const colors = ['#ff4500', '#1ed760', '#007bff'];

    // Draw ODF bands
    for (let band = 0; band < numBands; band++) {
      ctx.beginPath();
      ctx.strokeStyle = colors[band % colors.length];
      ctx.lineWidth = 1;

      const bandData = odfBands[band];

      let maxVal = 0;
      for (let i = 0; i < numFrames; i++) {
        if (bandData[i] > maxVal) maxVal = bandData[i];
      }

      const sliceWidth = canvas.width / (numFrames > 1 ? numFrames - 1 : 1);

      for (let i = 0; i < numFrames; i++) {
        const v = bandData[i];
        const normalizedV = maxVal > 0 ? v / maxVal : 0; // Normalize to [0, 1]
        const x = i * sliceWidth;
        const y = (1 - normalizedV) * canvas.height;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Draw beat markers on top
    if (this.latestBpm > 0) {
      const ibi = 60.0 / this.latestBpm; // inter-beat interval in seconds
      const currentTime = this.audioContext!.currentTime;

      const timeToNextBeat = -this.latestPhase / (2 * Math.PI) * ibi;
      const nextBeatTime = currentTime + timeToNextBeat;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1;

      const odfWindowStart = currentTime - BLOCK_DURATION_S;

      // Find the first beat time that should be visible in the window
      let beatTime = nextBeatTime;
      while (beatTime > odfWindowStart) {
        beatTime -= ibi;
      }
      beatTime += ibi;

      // Draw beat lines across the ODF window
      while (beatTime < currentTime) {
        const timeAgo = currentTime - beatTime;
        const x = canvas.width - (timeAgo / BLOCK_DURATION_S) * canvas.width;

        if (x >= 0 && x <= canvas.width) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        beatTime += ibi;
      }
    }
  }

  drawSpectrogram(ctx: CanvasRenderingContext2D, specBands: Float32Array[]) {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!specBands || specBands.length === 0) return;

    const numBands = specBands.length;
    const numFrames = specBands[0].length;

    const imageData = ctx.createImageData(numFrames, numBands);
    const data = imageData.data;

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < numBands; i++) {
      for (let j = 0; j < numFrames; j++) {
        const val = specBands[i][j];
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
    }

    const range = maxVal - minVal;

    for (let i = 0; i < numBands; i++) {
      for (let j = 0; j < numFrames; j++) {
        const val = specBands[i][j];
        const normalized = range > 0 ? (val - minVal) / range : 0;
        const brightness = Math.floor(normalized * 255);
        const pixelIndex = ((numBands - 1 - i) * numFrames + j) * 4;
        data[pixelIndex] = brightness;
        data[pixelIndex + 1] = brightness;
        data[pixelIndex + 2] = brightness;
        data[pixelIndex + 3] = 255;
      }
    }

    // Use a temporary canvas to scale the image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = numFrames;
    tempCanvas.height = numBands;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
  }

  drawWaveform(ctx: CanvasRenderingContext2D, buffer: Float32Array, color = '#1db954') {
    const canvas = ctx.canvas;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1; // Use 1 for sharper lines

    const samples = buffer.length;
    const samplesPerPixel = Math.floor(samples / width);
    const middle = height / 2;

    for (let i = 0; i < width; i++) {
      const start = i * samplesPerPixel;
      const end = start + samplesPerPixel;
      let min = 0.0;
      let max = 0.0;

      for (let j = start; j < end; j++) {
        const value = buffer[j];
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
      }

      const yMin = (1 - min * 0.5) * middle;
      const yMax = (1 - max * 0.5) * middle;

      ctx.moveTo(i, yMin);
      ctx.lineTo(i, yMax);
    }

    ctx.stroke();
  }
}
