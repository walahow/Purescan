import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Flashlight,
  FlashlightOff,
  Gauge,
  ImagePlus,
  Layers,
  RectangleHorizontal,
  RectangleVertical,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';
import {
  computeDocumentExposureBias,
  computeFastShutterPlan,
  computeMeanLuminance,
  formatShutterSpeed,
  type NumericRangeCapability,
} from '../imaging/cameraShutter';
import {
  CAMERA_GUIDE_PRESETS,
  computeDocumentGuideQuad,
  detectDocumentQuad,
  smoothQuad,
} from '../imaging/documentDetector';
import { cropBlobToAspectRatio } from '../imaging/ingest';
import { computeSharpnessScore } from '../imaging/sharpness';
import type {
  CameraCaptureResult,
  CameraGuideId,
  GuideOrientation,
  Quad,
  SharpnessStatus,
} from '../types/scan';

interface CameraViewProps {
  onSingleCapture: (capture: CameraCaptureResult) => void;
  /** Crops and saves each batch photo right after it is taken */
  onBatchCapture: (capture: CameraCaptureResult) => Promise<{ thumbnailBlob?: Blob } | void>;
  onBatchComplete: (savedCount: number) => Promise<void> | void;
  onFallbackGallery: () => void;
  onClose: () => void;
}

type CaptureMode = 'single' | 'batch';

interface VideoRect {
  left: number;
  top: number;
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
}

interface ExtendedCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
  exposureTime?: NumericRangeCapability;
  iso?: NumericRangeCapability;
  exposureCompensation?: NumericRangeCapability;
  pointsOfInterest?: unknown;
}

interface ExtendedSettings extends MediaTrackSettings {
  exposureMode?: string;
  exposureTime?: number;
  iso?: number;
}

interface ExtendedConstraintSet {
  torch?: boolean;
  focusMode?: string;
  exposureMode?: string;
  exposureTime?: number;
  iso?: number;
  exposureCompensation?: number;
  pointsOfInterest?: Array<{ x: number; y: number }>;
}

type ExtendedTrack = Omit<
  MediaStreamTrack,
  'getCapabilities' | 'getSettings' | 'applyConstraints'
> & {
  getCapabilities?: () => ExtendedCapabilities;
  getSettings?: () => ExtendedSettings;
  applyConstraints: (
    constraints: MediaTrackConstraints & { advanced?: ExtendedConstraintSet[] }
  ) => Promise<void>;
};

interface PhotoSettingsLike {
  imageWidth?: number;
  imageHeight?: number;
  fillLightMode?: 'auto' | 'off' | 'flash';
}

interface PhotoCapabilitiesLike {
  imageWidth?: { min?: number; max?: number; step?: number };
  imageHeight?: { min?: number; max?: number; step?: number };
  fillLightMode?: string[];
}

interface ImageCaptureLike {
  takePhoto: (settings?: PhotoSettingsLike) => Promise<Blob>;
  getPhotoCapabilities?: () => Promise<PhotoCapabilitiesLike>;
}

function getPreferredVideoConstraints(
  facing: 'environment' | 'user'
): MediaTrackConstraints[] {
  return [
    {
      facingMode: { ideal: facing },
      width: { ideal: 4096 },
      height: { ideal: 3072 },
    },
    {
      facingMode: { ideal: facing },
      width: { ideal: 2560 },
      height: { ideal: 1920 },
    },
    {
      facingMode: { ideal: facing },
      width: { ideal: 1920 },
      height: { ideal: 1440 },
    },
    {
      facingMode: { ideal: facing },
    },
  ];
}

export function CameraView({
  onSingleCapture,
  onBatchCapture,
  onBatchComplete,
  onFallbackGallery,
  onClose,
}: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const nativeCamInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const focusResetTimerRef = useRef<number | null>(null);
  const focusReticleTimerRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [mode, setMode] = useState<CaptureMode>('single');
  const [guideId, setGuideId] = useState<CameraGuideId>('a4');
  const [guideOrientation, setGuideOrientation] = useState<GuideOrientation>('auto');
  const guideIdRef = useRef<CameraGuideId>(guideId);
  const guideOrientationRef = useRef<GuideOrientation>(guideOrientation);
  guideIdRef.current = guideId;
  guideOrientationRef.current = guideOrientation;

  const [cameraReady, setCameraReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [shutterPrioritySupported, setShutterPrioritySupported] = useState(false);
  const [fastShutterOn, setFastShutterOn] = useState(true);
  const [shutterSpeedLabel, setShutterSpeedLabel] = useState<string | null>(null);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const trackCapsRef = useRef<ExtendedCapabilities | null>(null);
  const manualShutterActiveRef = useRef(false);
  const fastShutterOnRef = useRef(fastShutterOn);
  fastShutterOnRef.current = fastShutterOn;
  const shutterSettleTimerRef = useRef<number | null>(null);
  const badExposureCountRef = useRef(0);
  const cachedImageCaptureRef = useRef<ImageCaptureLike | null>(null);
  const cachedPhotoBaseSettingsRef = useRef<PhotoSettingsLike | null>(null);
  const cachedFillModesRef = useRef<string[]>([]);

  const [videoRect, setVideoRect] = useState<VideoRect | null>(null);
  const [liveQuad, setLiveQuad] = useState<Quad | null>(null);
  const liveQuadRef = useRef<Quad | null>(null);
  const [sharpnessStatus, setSharpnessStatus] = useState<SharpnessStatus>('fair');
  const [focusReticle, setFocusReticle] = useState<{ x: number; y: number } | null>(null);

  const [batchCount, setBatchCount] = useState(0);
  const [batchPendingCount, setBatchPendingCount] = useState(0);
  const [finishingBatch, setFinishingBatch] = useState(false);
  const [lastThumbUrl, setLastThumbUrl] = useState<string | null>(null);
  const batchThumbSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopStream = useCallback(() => {
    if (focusResetTimerRef.current) {
      window.clearTimeout(focusResetTimerRef.current);
      focusResetTimerRef.current = null;
    }
    if (shutterSettleTimerRef.current) {
      window.clearTimeout(shutterSettleTimerRef.current);
      shutterSettleTimerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    trackCapsRef.current = null;
    manualShutterActiveRef.current = false;
    badExposureCountRef.current = 0;
    cachedImageCaptureRef.current = null;
    cachedPhotoBaseSettingsRef.current = null;
    cachedFillModesRef.current = [];
    setCameraReady(false);
    setTorchOn(false);
    setTorchSupported(false);
    setShutterPrioritySupported(false);
    setShutterSpeedLabel(null);
    setLiveQuad(null);
    liveQuadRef.current = null;
  }, []);

  /** Applies continuous AF + AE with subtle -0.3 EV bias for faster shutter & crisp paper ink. */
  const applyContinuousDocumentExposure = useCallback(
    async (track: ExtendedTrack, caps: ExtendedCapabilities) => {
      const advanced: ExtendedConstraintSet[] = [];
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
        advanced.push({ exposureMode: 'continuous' });
      }
      const evBias = computeDocumentExposureBias(caps.exposureCompensation, -0.3);
      if (evBias !== undefined) {
        advanced.push({ exposureCompensation: evBias });
      }
      manualShutterActiveRef.current = false;
      badExposureCountRef.current = 0;
      if (advanced.length > 0 && typeof track.applyConstraints === 'function') {
        await track.applyConstraints({ advanced }).catch(() => undefined);
      }
    },
    []
  );

  /** Locks <=1/100s (or <=1/60s ceiling) fast shutter with proportional ISO if hardware allows. */
  const engageFastShutterPriority = useCallback(async (track: ExtendedTrack) => {
    const caps = trackCapsRef.current;
    if (!caps || !fastShutterOnRef.current || typeof track.getSettings !== 'function') return;
    if (!Array.isArray(caps.exposureMode) || !caps.exposureMode.includes('manual')) return;

    const settings = track.getSettings();
    const expLabel = formatShutterSpeed(settings.exposureTime);
    if (expLabel) setShutterSpeedLabel(expLabel);

    const plan = computeFastShutterPlan({
      currentExposure: settings.exposureTime,
      currentIso: settings.iso,
      exposureRange: caps.exposureTime,
      isoRange: caps.iso,
      targetExposure: 100, // 1/100s freezes indoor handheld text motion
      maxExposure: 167,
    });
    if (!plan.canApply || plan.alreadyFast || !plan.exposureTime || !plan.iso) return;

    try {
      await track.applyConstraints({
        advanced: [
          {
            exposureMode: 'manual',
            exposureTime: plan.exposureTime,
            iso: plan.iso,
          },
        ],
      });
      manualShutterActiveRef.current = true;
      badExposureCountRef.current = 0;
      if (plan.shutterLabel) setShutterSpeedLabel(plan.shutterLabel);
    } catch {
      manualShutterActiveRef.current = false;
    }
  }, []);

  const recalcVideoRect = useCallback(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const sr = stage.getBoundingClientRect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(sr.width / vw, sr.height / vh);
    const width = vw * scale;
    const height = vh * scale;
    const left = (sr.width - width) / 2;
    const top = (sr.height - height) / 2;

    setVideoRect({ left, top, width, height, videoWidth: vw, videoHeight: vh });
  }, []);

  const startCamera = useCallback(
    async (preferredFacing: 'environment' | 'user') => {
      stopStream();
      setErrorMsg(null);
      setVideoRect(null);

      if (
        typeof window !== 'undefined' &&
        !window.isSecureContext &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
      ) {
        setErrorMsg(
          'Live browser camera requires HTTPS. You can still use Native Cam or import photos below.'
        );
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg(
          'Live camera streaming is not supported in this browser. Use Native Cam or import photos below.'
        );
        return;
      }

      try {
        let stream: MediaStream | null = null;
        let lastErr: unknown = null;
        for (const videoConstraints of getPreferredVideoConstraints(preferredFacing)) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: videoConstraints,
              audio: false,
            });
            break;
          } catch (err) {
            lastErr = err;
            const name = err instanceof DOMException ? err.name : '';
            if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'NotFoundError') {
              throw err;
            }
          }
        }

        if (!stream) {
          throw lastErr ?? new Error('Unable to acquire camera stream.');
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          recalcVideoRect();
        }

        const track = stream.getVideoTracks()[0] as ExtendedTrack | undefined;
        if (track && typeof track.getCapabilities === 'function') {
          try {
            const caps = track.getCapabilities() as ExtendedCapabilities;
            trackCapsRef.current = caps;
            setTorchSupported(Boolean(caps?.torch));

            const canManualShutter = Boolean(
              Array.isArray(caps?.exposureMode) &&
                caps.exposureMode.includes('manual') &&
                caps.exposureTime &&
                caps.iso
            );
            setShutterPrioritySupported(canManualShutter);

            await applyContinuousDocumentExposure(track, caps);

            if (canManualShutter && fastShutterOnRef.current) {
              shutterSettleTimerRef.current = window.setTimeout(() => {
                if (mountedRef.current && streamRef.current === stream) {
                  void engageFastShutterPriority(track);
                }
              }, 480);
            }
          } catch {
            setTorchSupported(false);
            setShutterPrioritySupported(false);
          }
        }

        // Pre-warm ImageCapture & cache full-res PhotoCapabilities so shutter has zero IPC wait
        const ImageCaptureCtor = (
          window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }
        ).ImageCapture;
        if (track && typeof ImageCaptureCtor === 'function') {
          try {
            const ic = new ImageCaptureCtor(track as unknown as MediaStreamTrack);
            cachedImageCaptureRef.current = ic;
            if (typeof ic.getPhotoCapabilities === 'function') {
              void ic
                .getPhotoCapabilities()
                .then((pCaps) => {
                  if (!mountedRef.current || cachedImageCaptureRef.current !== ic) return;
                  const base: PhotoSettingsLike = {};
                  const maxW = pCaps.imageWidth?.max;
                  const maxH = pCaps.imageHeight?.max;
                  if (maxW && maxH) {
                    const longest = Math.max(maxW, maxH);
                    const cap = 4608;
                    if (longest > cap) {
                      const scale = cap / longest;
                      base.imageWidth = Math.round(maxW * scale);
                      base.imageHeight = Math.round(maxH * scale);
                    } else {
                      base.imageWidth = maxW;
                      base.imageHeight = maxH;
                    }
                  } else {
                    if (maxW) base.imageWidth = Math.min(4608, maxW);
                    if (maxH) base.imageHeight = Math.min(4608, maxH);
                  }
                  cachedPhotoBaseSettingsRef.current = base;
                  cachedFillModesRef.current = Array.isArray(pCaps.fillLightMode)
                    ? pCaps.fillLightMode
                    : [];
                })
                .catch(() => undefined);
            }
          } catch {
            cachedImageCaptureRef.current = null;
          }
        }
        setCameraReady(true);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setErrorMsg(
            'Camera permission was denied. Allow camera access in browser settings, or use Native Cam / Import below.'
          );
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setErrorMsg('No camera detected on this device. You can import existing document photos below.');
        } else {
          setErrorMsg('Unable to start live camera. Try Native Cam or importing photos below.');
        }
      }
    },
    [applyContinuousDocumentExposure, engageFastShutterPriority, recalcVideoRect, stopStream]
  );

  useEffect(() => {
    void startCamera(facingMode);
    return () => {
      stopStream();
    };
  }, [facingMode, startCamera, stopStream]);

  useEffect(() => {
    recalcVideoRect();
    const ro = new ResizeObserver(recalcVideoRect);
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener('resize', recalcVideoRect);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalcVideoRect);
    };
  }, [recalcVideoRect]);

  useEffect(() => {
    return () => {
      if (lastThumbUrl) URL.revokeObjectURL(lastThumbUrl);
      if (focusReticleTimerRef.current) window.clearTimeout(focusReticleTimerRef.current);
    };
  }, [lastThumbUrl]);

  // Live ~4 fps offscreen document quad + sharpness telemetry loop
  useEffect(() => {
    if (!cameraReady || capturing || errorMsg) return;

    const canvas = document.createElement('canvas');
    let timerId: number | null = null;
    let active = true;
    let missedFrames = 0;

    const tick = () => {
      if (!active) return;
      const video = videoRef.current;
      if (video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        const targetMax = 320;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.min(1, targetMax / Math.max(vw, vh));
        const w = Math.max(48, Math.round(vw * scale));
        const h = Math.max(48, Math.round(vh * scale));

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const sharp = computeSharpnessScore(img.data, w, h);
          setSharpnessStatus(sharp.status);

          const activeTrack = streamRef.current?.getVideoTracks()[0] as ExtendedTrack | undefined;
          if (activeTrack && typeof activeTrack.getSettings === 'function') {
            const liveLabel = formatShutterSpeed(activeTrack.getSettings().exposureTime);
            if (liveLabel) setShutterSpeedLabel(liveLabel);
          }

          if (manualShutterActiveRef.current && activeTrack && trackCapsRef.current) {
            const meanLuma = computeMeanLuminance(img.data, 4);
            if (meanLuma < 58 || meanLuma > 242) {
              badExposureCountRef.current++;
              if (badExposureCountRef.current >= 2) {
                void applyContinuousDocumentExposure(activeTrack, trackCapsRef.current);
              }
            } else {
              badExposureCountRef.current = 0;
            }
          }

          const guideFallback = computeDocumentGuideQuad(
            vw,
            vh,
            guideIdRef.current,
            guideOrientationRef.current
          );
          const det = detectDocumentQuad(img.data, w, h, {
            fallbackQuad: guideFallback,
            hintQuad: liveQuadRef.current ?? guideFallback,
            workingMaxDim: 320,
          });
          if (det.detected) {
            missedFrames = 0;
            const smoothed = smoothQuad(liveQuadRef.current, det.quad, 0.52);
            liveQuadRef.current = smoothed;
            setLiveQuad(smoothed);
          } else {
            missedFrames++;
            if (missedFrames >= 3) {
              liveQuadRef.current = null;
              setLiveQuad(null);
            }
          }
        }
      }
      if (active) {
        timerId = window.setTimeout(tick, 250);
      }
    };

    timerId = window.setTimeout(tick, 180);
    return () => {
      active = false;
      if (timerId !== null) window.clearTimeout(timerId);
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [applyContinuousDocumentExposure, cameraReady, capturing, errorMsg]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0] as ExtendedTrack | undefined;
    if (!track || !torchSupported) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
      // Let AE adapt to new light level before re-locking fast shutter
      if (trackCapsRef.current) {
        await applyContinuousDocumentExposure(track, trackCapsRef.current);
        if (shutterPrioritySupported && fastShutterOnRef.current) {
          if (shutterSettleTimerRef.current) window.clearTimeout(shutterSettleTimerRef.current);
          shutterSettleTimerRef.current = window.setTimeout(() => {
            if (mountedRef.current) void engageFastShutterPriority(track);
          }, 420);
        }
      }
    } catch {
      setTorchSupported(false);
    }
  };

  const toggleFastShutter = async () => {
    const track = streamRef.current?.getVideoTracks()[0] as ExtendedTrack | undefined;
    if (!track || !shutterPrioritySupported || !trackCapsRef.current) return;
    const next = !fastShutterOn;
    setFastShutterOn(next);
    fastShutterOnRef.current = next;
    if (next) {
      await applyContinuousDocumentExposure(track, trackCapsRef.current);
      if (shutterSettleTimerRef.current) window.clearTimeout(shutterSettleTimerRef.current);
      shutterSettleTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) void engageFastShutterPriority(track);
      }, 280);
    } else {
      await applyContinuousDocumentExposure(track, trackCapsRef.current);
    }
  };

  const handleTapToFocus = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cameraReady || !videoRect || !stageRef.current || capturing) return;
    const sr = stageRef.current.getBoundingClientRect();
    const localX = e.clientX - sr.left;
    const localY = e.clientY - sr.top;

    // Only focus if user tapped inside the live video frame
    if (
      localX < videoRect.left ||
      localX > videoRect.left + videoRect.width ||
      localY < videoRect.top ||
      localY > videoRect.top + videoRect.height
    ) {
      return;
    }

    const normX = Math.max(0.05, Math.min(0.95, (localX - videoRect.left) / videoRect.width));
    const normY = Math.max(0.05, Math.min(0.95, (localY - videoRect.top) / videoRect.height));

    setFocusReticle({ x: localX, y: localY });
    if (focusReticleTimerRef.current) window.clearTimeout(focusReticleTimerRef.current);
    focusReticleTimerRef.current = window.setTimeout(() => setFocusReticle(null), 1100);

    const track = streamRef.current?.getVideoTracks()[0] as ExtendedTrack | undefined;
    if (!track || typeof track.getCapabilities !== 'function') return;

    try {
      const caps = track.getCapabilities() as ExtendedCapabilities;
      const constraint: ExtendedConstraintSet = {};
      if (caps.pointsOfInterest) {
        constraint.pointsOfInterest = [{ x: normX, y: normY }];
      }
      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('single-shot')) constraint.focusMode = 'single-shot';
        else if (caps.focusMode.includes('continuous')) constraint.focusMode = 'continuous';
      }
      if (Object.keys(constraint).length > 0) {
        await track.applyConstraints({ advanced: [constraint] });
      }
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        if (focusResetTimerRef.current) window.clearTimeout(focusResetTimerRef.current);
        focusResetTimerRef.current = window.setTimeout(() => {
          void track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => undefined);
        }, 1250);
      }
    } catch {
      // Device ignores tap-to-focus constraints silently
    }
  };

  /**
   * Captures the sharpest possible still frame that matches the live preview aspect ratio 1:1.
   */
  const captureFrameResult = async (): Promise<CameraCaptureResult> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('Camera feed is not ready yet.');
    }

    const previewAspect = video.videoWidth / video.videoHeight;
    const previewQuad = liveQuadRef.current
      ? (liveQuadRef.current.map((p) => ({ ...p })) as Quad)
      : undefined;
    const currentGuideId = guideIdRef.current;
    const currentPreset =
      CAMERA_GUIDE_PRESETS.find((g) => g.id === currentGuideId) ?? CAMERA_GUIDE_PRESETS[0];
    const fallbackQuad = computeDocumentGuideQuad(
      video.videoWidth,
      video.videoHeight,
      currentGuideId,
      guideOrientationRef.current
    );
    const suggestedAspectMode = currentPreset.cropAspectMode;

    const stream = streamRef.current;
    const track = stream?.getVideoTracks()[0];

    // 1. Prefer cached full-sensor ImageCapture.takePhoto() with zero per-tap capabilities stall
    const ic = cachedImageCaptureRef.current;
    if (track && ic) {
      try {
        let photoBlob: Blob | null = null;
        const base = cachedPhotoBaseSettingsRef.current;
        if (base) {
          try {
            const settings: PhotoSettingsLike = { ...base };
            const fillModes = cachedFillModesRef.current;
            if (torchOn && fillModes.includes('flash')) settings.fillLightMode = 'flash';
            else if (fillModes.includes('off')) settings.fillLightMode = 'off';
            photoBlob = await ic.takePhoto(settings);
          } catch {
            // Some Android drivers reject PhotoSettings — retry bare takePhoto()
          }
        }

        if (!photoBlob) {
          photoBlob = await ic.takePhoto();
        }

        if (photoBlob && photoBlob.size > 0) {
          // Ensure captured photo matches the exact live preview framing 1:1
          const syncedBlob = await cropBlobToAspectRatio(photoBlob, previewAspect, 0.97);
          return { blob: syncedBlob, previewQuad, fallbackQuad, suggestedAspectMode };
        }
      } catch {
        // Fall through to fast sharpest-frame burst capture
      }
    }

    // 2. Fast sharpest-frame burst fallback (2-3 frames spaced 18ms, single JPEG 0.97 encode)
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const workCanvas = document.createElement('canvas');
    workCanvas.width = vw;
    workCanvas.height = vh;
    const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
    if (!workCtx) throw new Error('Canvas unavailable.');

    const bestCanvas = document.createElement('canvas');
    bestCanvas.width = vw;
    bestCanvas.height = vh;
    const bestCtx = bestCanvas.getContext('2d');
    if (!bestCtx) throw new Error('Canvas unavailable.');

    const probeCanvas = document.createElement('canvas');
    const pScale = Math.min(1, 280 / Math.max(vw, vh));
    probeCanvas.width = Math.max(48, Math.round(vw * pScale));
    probeCanvas.height = Math.max(48, Math.round(vh * pScale));
    const pCtx = probeCanvas.getContext('2d', { willReadFrequently: true });

    let bestBlob: Blob | null = null;
    let bestScore = -1;

    try {
      const frameCount = 3;
      for (let i = 0; i < frameCount; i++) {
        if (i > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 18));
        }

        workCtx.drawImage(video, 0, 0, vw, vh);
        let score = 0;
        let isSharp = false;
        if (pCtx) {
          pCtx.drawImage(workCanvas, 0, 0, probeCanvas.width, probeCanvas.height);
          const pData = pCtx.getImageData(0, 0, probeCanvas.width, probeCanvas.height);
          const report = computeSharpnessScore(pData.data, probeCanvas.width, probeCanvas.height);
          score = report.score;
          isSharp = report.status === 'sharp';
        }

        if (score >= bestScore) {
          bestScore = score;
          bestCtx.drawImage(workCanvas, 0, 0, vw, vh);
        }

        // Stop early after 2 frames once already crisp-sharp to minimize shutter lag
        if (i >= 1 && isSharp) break;
      }

      bestBlob = await new Promise<Blob>((resolve, reject) => {
        bestCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to capture camera frame.'))),
          'image/jpeg',
          0.97
        );
      });
    } finally {
      probeCanvas.width = 0;
      probeCanvas.height = 0;
      workCanvas.width = 0;
      workCanvas.height = 0;
      bestCanvas.width = 0;
      bestCanvas.height = 0;
    }

    if (!bestBlob) throw new Error('Failed to capture camera frame.');
    return { blob: bestBlob, previewQuad, fallbackQuad, suggestedAspectMode };
  };

  const startImmediateBatchSave = (capture: CameraCaptureResult) => {
    const seq = ++batchThumbSeqRef.current;
    setBatchCount((c) => c + 1);
    setBatchPendingCount((c) => c + 1);

    const quickUrl = URL.createObjectURL(capture.blob);
    setLastThumbUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return quickUrl;
    });

    void onBatchCapture(capture)
      .then((saved) => {
        if (!mountedRef.current) return;
        const thumb = saved && 'thumbnailBlob' in saved ? saved.thumbnailBlob : undefined;
        if (thumb && batchThumbSeqRef.current === seq) {
          const croppedUrl = URL.createObjectURL(thumb);
          setLastThumbUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return croppedUrl;
          });
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setBatchCount((c) => Math.max(0, c - 1));
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setBatchPendingCount((c) => Math.max(0, c - 1));
        }
      });
  };

  const handleShutter = async () => {
    if (!cameraReady || capturing || finishingBatch) return;
    setCapturing(true);
    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 140);

    try {
      const result = await captureFrameResult();
      if (mode === 'single') {
        stopStream();
        onSingleCapture(result);
      } else {
        // Clear previous page's quad lock so next page acquires its own lock cleanly
        liveQuadRef.current = null;
        setLiveQuad(null);
        startImmediateBatchSave(result);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setCapturing(false);
    }
  };

  const handleNativeCamChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (mode === 'single') {
      stopStream();
      onSingleCapture({ blob: file });
    } else {
      startImmediateBatchSave({ blob: file });
    }
  };

  const handleFinishBatch = async () => {
    if (finishingBatch) return;
    setFinishingBatch(true);
    stopStream();
    await onBatchComplete(batchCount);
  };

  const handleClose = () => {
    stopStream();
    onClose();
  };

  const activeGuidePreset =
    CAMERA_GUIDE_PRESETS.find((g) => g.id === guideId) ?? CAMERA_GUIDE_PRESETS[0];

  const effectiveOrientation: 'portrait' | 'landscape' =
    guideOrientation === 'auto'
      ? activeGuidePreset.defaultOrientation === 'auto'
        ? videoRect && videoRect.videoHeight >= videoRect.videoWidth
          ? 'portrait'
          : 'landscape'
        : activeGuidePreset.defaultOrientation
      : guideOrientation;

  const toggleGuideOrientation = () => {
    setGuideOrientation(effectiveOrientation === 'portrait' ? 'landscape' : 'portrait');
  };

  // Exact document guide coordinates inside the rendered video rectangle
  const guideNorm = videoRect
    ? computeDocumentGuideQuad(
        videoRect.videoWidth,
        videoRect.videoHeight,
        guideId,
        guideOrientation
      )
    : null;
  const guidePx =
    videoRect && guideNorm
      ? {
          left: guideNorm[0].x * videoRect.width,
          top: guideNorm[0].y * videoRect.height,
          width: (guideNorm[1].x - guideNorm[0].x) * videoRect.width,
          height: (guideNorm[3].y - guideNorm[0].y) * videoRect.height,
        }
      : null;

  const livePtsStr =
    videoRect && liveQuad
      ? liveQuad
          .map((p) => `${p.x * videoRect.width},${p.y * videoRect.height}`)
          .join(' ')
      : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white select-none">
      {/* Hidden native OS camera input (works 100% offline via device hardware ISP) */}
      <input
        ref={nativeCamInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleNativeCamChange}
        className="hidden"
      />

      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md pt-safe z-20">
        <button
          type="button"
          onClick={handleClose}
          className="flex items-center gap-1.5 h-10 px-3 border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-white hover:text-zinc-900 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
        >
          <X size={15} />
          Close
        </button>

        {/* Single / Batch Segmented Switch */}
        <div className="flex border border-zinc-700 bg-zinc-900">
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`px-3 h-9 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
              mode === 'single' ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Single
          </button>
          <button
            type="button"
            onClick={() => setMode('batch')}
            className={`flex items-center gap-1.5 px-3 h-9 font-mono text-[10px] font-bold uppercase tracking-wider border-l border-zinc-700 transition-colors cursor-pointer ${
              mode === 'batch' ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Layers size={12} />
            Batch
          </button>
        </div>

        {/* Utility Controls: Fast Shutter + Torch + Flip */}
        <div className="flex items-center gap-1.5">
          {shutterPrioritySupported && (
            <button
              type="button"
              onClick={() => void toggleFastShutter()}
              title={
                fastShutterOn
                  ? 'Fast shutter priority active (reduces motion blur on small text)'
                  : 'Switch to fast shutter priority'
              }
              aria-label={fastShutterOn ? 'Fast shutter priority on' : 'Fast shutter priority off'}
              className={`h-10 px-2.5 flex items-center gap-1 border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                fastShutterOn
                  ? 'bg-[#2eb846] text-zinc-950 border-[#2eb846]'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              <Gauge size={13} />
              <span>{shutterSpeedLabel ?? 'Fast'}</span>
            </button>
          )}
          {torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
              className={`h-10 w-10 flex items-center justify-center border transition-colors cursor-pointer ${
                torchOn
                  ? 'bg-amber-400 text-zinc-950 border-amber-400'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {torchOn ? <Flashlight size={16} /> : <FlashlightOff size={16} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'))}
            aria-label="Switch camera"
            className="h-10 w-10 flex items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-500 cursor-pointer"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* WYSIWYG Viewfinder Stage */}
      <div
        ref={stageRef}
        onPointerDown={handleTapToFocus}
        className="relative flex-1 overflow-hidden bg-black flex items-center justify-center"
      >
        {errorMsg ? (
          <div className="w-full max-w-md mx-4 bg-white text-zinc-900 border border-zinc-300 shadow-[10px_10px_0px_0px_rgba(255,255,255,0.12)] p-6">
            <div className="h-1 w-full bg-zinc-900 -mt-6 -mx-6 mb-5 w-[calc(100%+3rem)]" />
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400 mb-2">
              // CAMERA_UNAVAILABLE
            </p>
            <p className="text-sm text-zinc-700 leading-relaxed mb-5">{errorMsg}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => nativeCamInputRef.current?.click()}
                className="h-11 px-4 bg-zinc-900 text-white font-mono text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-zinc-800 cursor-pointer"
              >
                <Smartphone size={15} />
                Native Cam
              </button>
              <button
                type="button"
                onClick={() => {
                  stopStream();
                  onFallbackGallery();
                }}
                className="h-11 px-4 border border-zinc-300 bg-white text-zinc-900 font-mono text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-zinc-100 cursor-pointer"
              >
                <ImagePlus size={15} />
                Import Photos
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* object-contain ensures 100% WYSIWYG match between live preview and captured photo */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              onLoadedMetadata={recalcVideoRect}
              onResize={recalcVideoRect}
              className="h-full w-full object-contain"
            />

            {/* Exact Video-Anchored Document Guide + Live Detected Quad Overlay */}
            {videoRect && guidePx && (
              <div
                style={{
                  left: videoRect.left,
                  top: videoRect.top,
                  width: videoRect.width,
                  height: videoRect.height,
                }}
                className="pointer-events-none absolute overflow-hidden"
              >
                <svg
                  width={videoRect.width}
                  height={videoRect.height}
                  className="absolute inset-0"
                >
                  <defs>
                    <mask id="camera-doc-mask">
                      <rect width={videoRect.width} height={videoRect.height} fill="white" />
                      <rect
                        x={guidePx.left}
                        y={guidePx.top}
                        width={guidePx.width}
                        height={guidePx.height}
                        fill="black"
                      />
                    </mask>
                  </defs>

                  {/* Dim outside active document guide frame */}
                  <rect
                    width={videoRect.width}
                    height={videoRect.height}
                    fill={guideId === 'free' ? 'rgba(9, 9, 11, 0.16)' : 'rgba(9, 9, 11, 0.36)'}
                    mask="url(#camera-doc-mask)"
                  />

                  {/* Exact guide boundary hairline */}
                  <rect
                    x={guidePx.left}
                    y={guidePx.top}
                    width={guidePx.width}
                    height={guidePx.height}
                    fill="none"
                    stroke="rgba(255,255,255,0.42)"
                    strokeWidth="1"
                    strokeDasharray="6 4"
                  />

                  {/* Live auto-detected document polygon */}
                  {livePtsStr && (
                    <polygon
                      points={livePtsStr}
                      fill="rgba(46, 184, 70, 0.10)"
                      stroke="#2eb846"
                      strokeWidth="2.5"
                    />
                  )}
                </svg>

                {/* Crisp HYDE Registration Brackets on exact guide corners */}
                <div
                  style={{
                    left: guidePx.left,
                    top: guidePx.top,
                    width: guidePx.width,
                    height: guidePx.height,
                  }}
                  className="absolute"
                >
                  <div className="absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] border-white" />
                  <div className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-white" />
                  <div className="absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] border-white" />
                  <div className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-white" />

                  <div className="absolute inset-x-2 h-px bg-white/75 shadow-[0_0_10px_rgba(255,255,255,0.85)] animate-scan-line" />

                  <div className="absolute top-2 left-2 bg-zinc-950/75 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest uppercase text-zinc-200">
                    {activeGuidePreset.label} · {activeGuidePreset.dimensionsLabel}
                  </div>
                </div>

                {/* Live Sharpness & Lock Telemetry Pill */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-zinc-950/80 border border-zinc-800 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">
                  <span
                    className={`w-1.5 h-1.5 ${
                      sharpnessStatus === 'sharp'
                        ? 'bg-[#2eb846]'
                        : sharpnessStatus === 'fair'
                        ? 'bg-zinc-300'
                        : 'bg-amber-400'
                    }`}
                  />
                  <span className="text-zinc-200">
                    {sharpnessStatus === 'sharp'
                      ? 'SHARP'
                      : sharpnessStatus === 'fair'
                      ? 'TAP TO FOCUS'
                      : 'HOLD STEADY'}
                  </span>
                  {shutterSpeedLabel && (
                    <>
                      <span className="text-zinc-600">·</span>
                      <span className="text-zinc-300">{shutterSpeedLabel}</span>
                    </>
                  )}
                  <span className="text-zinc-600">·</span>
                  <span className={liveQuad ? 'text-[#2eb846] font-bold' : 'text-zinc-400'}>
                    {liveQuad
                      ? 'DOC_LOCKED'
                      : mode === 'batch'
                      ? batchPendingCount > 0
                        ? `BATCH · ${batchCount} (SAVING)`
                        : `BATCH · ${batchCount}`
                      : `ALIGN ${activeGuidePreset.label.toUpperCase()}`}
                  </span>
                </div>
              </div>
            )}

            {/* Tap-to-Focus HYDE Reticle */}
            {focusReticle && (
              <div
                style={{ left: focusReticle.x, top: focusReticle.y }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-14 h-14 border-2 border-[#2eb846] shadow-[0_0_12px_rgba(46,184,70,0.45)] animate-ping"
              />
            )}

            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 font-mono text-xs uppercase tracking-widest text-zinc-400">
                INITIALIZING_OPTICS...
              </div>
            )}

            {/* Shutter Flash Feedback */}
            {shutterFlash && <div className="pointer-events-none absolute inset-0 bg-white/80 z-30" />}
          </>
        )}
      </div>

      {/* Document Frame Preview Selector Strip */}
      {!errorMsg && (
        <div className="border-t border-zinc-800/80 bg-zinc-950/95 px-3 py-2 z-20">
          <div className="mx-auto max-w-xl flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            {CAMERA_GUIDE_PRESETS.map((preset) => {
              const active = guideId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setGuideId(preset.id);
                    setGuideOrientation('auto');
                  }}
                  className={`shrink-0 h-7 px-2.5 border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    active
                      ? 'bg-white text-zinc-950 border-white'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-600'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}

            {guideId !== 'free' && (
              <button
                type="button"
                onClick={toggleGuideOrientation}
                aria-label="Flip document frame orientation"
                title={`Guide orientation: ${effectiveOrientation}`}
                className="ml-auto shrink-0 h-7 px-2 border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-600 font-mono text-[10px] uppercase tracking-wider flex items-center gap-1 cursor-pointer"
              >
                {effectiveOrientation === 'portrait' ? (
                  <RectangleVertical size={12} />
                ) : (
                  <RectangleHorizontal size={12} />
                )}
                <span className="hidden sm:inline">
                  {effectiveOrientation === 'portrait' ? 'Portrait' : 'Landscape'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom Shutter Control Dock */}
      <div className="border-t border-zinc-800 bg-zinc-950 px-5 py-4 pb-safe z-20">
        <div className="mx-auto max-w-md flex items-center justify-between gap-4">
          {/* Left slot: Batch counter OR Gallery import */}
          <div className="w-28 flex items-center justify-start gap-3">
            {batchCount > 0 && lastThumbUrl ? (
              <div className="relative flex items-center gap-2">
                <div className="relative">
                  <img
                    src={lastThumbUrl}
                    alt="Last captured page"
                    className={`h-12 w-9 object-cover border bg-zinc-900 ${
                      batchPendingCount > 0 ? 'border-amber-400/80' : 'border-[#2eb846]'
                    }`}
                  />
                  <span
                    className={`absolute -top-1 -right-1 w-2 h-2 ${
                      batchPendingCount > 0 ? 'bg-amber-400 animate-pulse' : 'bg-[#2eb846]'
                    }`}
                  />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="font-mono text-xs font-bold text-white">
                    ×{batchCount}
                  </span>
                  <span className="font-mono text-[8px] uppercase tracking-wider text-zinc-400">
                    {batchPendingCount > 0 ? 'Cropping...' : 'Saved'}
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  stopStream();
                  onFallbackGallery();
                }}
                className="flex flex-col items-center gap-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <ImagePlus size={19} />
                <span className="font-mono text-[9px] uppercase tracking-wider">Import</span>
              </button>
            )}
          </div>

          {/* Center Shutter Button */}
          <button
            type="button"
            onClick={handleShutter}
            disabled={!cameraReady || capturing || finishingBatch || Boolean(errorMsg)}
            aria-label="Capture document photo"
            className="relative h-16 w-16 rounded-full border-[3px] border-white p-1 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-35 cursor-pointer"
          >
            <span className="h-full w-full rounded-full bg-white flex items-center justify-center">
              <Camera size={22} className="text-zinc-950" />
            </span>
          </button>

          {/* Right slot: Done button (Batch) OR Native OS Camera escape hatch */}
          <div className="w-28 flex items-center justify-end">
            {batchCount > 0 ? (
              <button
                type="button"
                onClick={() => void handleFinishBatch()}
                disabled={finishingBatch}
                className="h-11 px-3.5 bg-white text-zinc-950 font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-zinc-200 transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Check size={15} strokeWidth={3} />
                {finishingBatch ? 'Saving...' : `Done (${batchCount})`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => nativeCamInputRef.current?.click()}
                title="Use phone's native camera hardware (100% offline)"
                className="flex flex-col items-center gap-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <Smartphone size={19} />
                <span className="font-mono text-[9px] uppercase tracking-wider">Native Cam</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
