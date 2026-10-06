/**
 * Elata rPPG for the browser: camera-based pulse estimation, WASM backend, and
 * session helpers. Prefer {@link createRppgSession} for new apps; see `llms.txt`
 * in the package root for constraints (secure context, Vite WASM patterns).
 */
export { RppgProcessor, MuseCalibrationModel, MuseFusionCalibrator, museStyleFilter, } from "./rppgProcessor.js";
export { BpmBayesTracker, DEFAULT_BPM_TRACKER_CONFIG_V1, parseBpmTrackerConfigV1, } from "./bpmBayesTracker.js";
export { DemoRunner } from "./demoRunner.js";
export { MediaPipeFrameSource } from "./mediaPipeFrameSource.js";
export { MediaPipeFaceFrameSource } from "./mediaPipeFaceFrameSource.js";
export { loadFaceLandmarker } from "./mediapipeLoader.js";
export { averageGreenInROI } from "./frameSource.js";
export { AffectTracker } from "./affectTracker.js";
export { BaselineCalibrator, DEFAULT_BASELINE_CALIBRATOR_CONFIG, } from "./baselineCalibrator.js";
export { CAPTURE_MOTION_RELIABILITY, CaptureConfidenceScorer, DEFAULT_CAPTURE_CONFIDENCE_CONFIG, scoreCaptureFeatures, } from "./captureConfidence.js";
export { loadWasmBackend } from "./wasmBackend.js";
export { createUnavailableBackend } from "./wasmBackend.js";
export { createRppgSession, RppgSession, } from "./rppgSession.js";
export { createManagedRppgSession, ManagedRppgSession, } from "./managedRppgSession.js";
export { computeWaveformPeriodicityProfile } from "./rppgDiagnostics.js";
export { computeTraceWaveformDebug } from "./rppgDiagnostics.js";
export { analyzePulseWindow, calculateBpmViaAutocorrelation, cleanNnIntervalsMs, computeRmssdMs, detectBeatsViaHilbertPhase, detectPeaks, estimateDominantBpm, refinePeakByInterpolation, rmssdFromPeaks, temporalNormalize, } from "./pulseAnalysis.js";
export { amplitudeEnvelope, dominantInBand, estimateRespiration, resampleTachogram, } from "./respirationAnalysis.js";
export { Bandpass, ChannelGainController, ChromPulseModel, computeSignalSnrDb, PosPulseModel, spectralSnr, zeroPhaseBandpass, } from "./rppgSignalModel.js";
export { FUSION_ROIS, MultiRoiRppgFuser } from "./multiRoiFusion.js";
export { applyNoReferenceDisplayGuard, shouldAllowDisplayJumpReset, } from "./displayGuard.js";
export { affectStress, blendshapeValenceArousal, classifyAffectLabel, fuseAffect, physiologyArousal, } from "./affect.js";
export { DisplayBpmTracker } from "./displayBpm.js";
export { computeFaceRoiRects, computeFusionSubRois, drawFaceOverlay, FACE_ROI_FRACTIONS, FUSION_ROI_NAMES, } from "./faceRoiOverlay.js";
export { ELATA_FACE_YCBCR_V1_FRACTIONS, ELATA_FACE_YCBCR_V1_PROFILE, MCD_PROXY_INPUT_V1_FRACTIONS, MCD_PROXY_INPUT_V1_PROFILE, TRADELOCK_LIVE_FOREHEAD_V1_PROFILE, computeFractionalFaceRoiRects, } from "./roiProfile.js";
export { ELATA_YCBCR_V1_PIXEL_SAMPLER, TRADELOCK_RGB_WEIGHTED_V1_PIXEL_SAMPLER, isTradeLockSkinPixel, isYcbcrSkinPixel, sampleRppgRoi, tradeLockSpatialWeight, } from "./roiPixelSampler.js";
export { MCD_WAVEFORM_CHANNELS, MCD_WAVEFORM_ROIS, WaveformFeatureWindowBuilder, } from "./waveformFeatureWindow.js";
export { WaveformModelError } from "./waveformModel.js";
export { WaveformReconstructionController } from "./waveformReconstructionController.js";
export { createWaveformMorphologyBaseline, extractWaveformMorphology, } from "./waveformMorphology.js";
export { createPhysiologyInterpreter, DEFAULT_PHYSIOLOGY_INTERPRETER_CONFIG_V1, normalizePhysiologyFeatures, } from "./physiologyFeatures.js";
export { DEFAULT_FRAMING_THRESHOLDS, FRAMING_MESSAGES, faceBoxFromLandmarks, faceFramingFromBox, padFaceBoxToHead, } from "./faceFraming.js";
export { normalizeRppgError } from "./rppgErrors.js";
export { createRppgAppAdapter, createRppgAppMonitor, RppgAppAdapter, RppgAppMonitor, } from "./rppgAppAdapter.js";
export { ensureVideoPlaying } from "./videoPlayback.js";
export { RppgGatingController } from "./rppgGating.js";
export { replayBayesSession } from "./rppgReplay.js";
export { RppgSessionRecorder } from "./rppgSessionRecorder.js";
export { aggregateComparisons, maeOf, summarizeReplaySession, } from "./replayBenchmark.js";
export { PulseCheck } from "./pulseCheck.js";
export { FIX_SWITCH_NAMES, resolveFixSwitches, } from "./fixSwitches.js";
export { RPPG_WEB_BUILD_VERSION } from "./buildInfo.js";
export { createWorkerRppgProcessor, WorkerRppgProcessor, } from "./workerRppgProcessor.js";
