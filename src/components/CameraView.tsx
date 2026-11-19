import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Flashlight,
  FlashlightOff,
  ImagePlus,
  Layers,
  RefreshCw,
  X,
} from 'lucide-react';

interface CameraViewProps {
  onSingleCapture: (blob: Blob) => void;
  onBatchComplete: (blobs: Blob[]) => void;
  onFallbackGallery: () => void;
  onClose: () => void;
}

type CaptureMode = 'single' | 'batch';

type MediaTrackWithTorch = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
  applyConstraints: (
    constraints: MediaTrackConstraints & { advanced?: Array<{ torch?: boolean }> }
  ) => Promise<void>;
};

interface ImageCaptureLike {
  takePhoto: () => Promise<Blob>;
}

export function CameraView({
  onSingleCapture,
  onBatchComplete,
  onFallbackGallery,
  onClose,
}: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [mode, setMode] = useState<CaptureMode>('single');
  const [cameraReady, setCameraReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const [batchBlobs, setBatchBlobs] = useState<Blob[]>([]);
  const [lastThumbUrl, setLastThumbUrl] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraReady(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const startCamera = useCallback(
    async (preferredFacing: 'environment' | 'user') => {
      stopStream();
      setErrorMsg(null);

      if (
        typeof window !== 'undefined' &&
        !window.isSecureContext &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
      ) {
        setErrorMsg(
          'Live browser camera requires HTTPS. You can still import existing document photos below.'
        );
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg(
          'Live camera streaming is not supported in this browser. Import existing photos below.'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: preferredFacing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        const track = stream.getVideoTracks()[0] as MediaTrackWithTorch | undefined;
        if (track && typeof track.getCapabilities === 'function') {
          try {
            const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
            setTorchSupported(Boolean(caps?.torch));
          } catch {
            setTorchSupported(false);
          }
        }
        setCameraReady(true);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setErrorMsg(
            'Camera permission was denied. Allow camera access in your browser settings, or import existing photos below.'
          );
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setErrorMsg('No camera detected on this device. You can import existing document photos below.');
        } else {
          setErrorMsg('Unable to start live camera. Try importing photos below.');
        }
      }
    },
    [stopStream]
  );

  useEffect(() => {
    void startCamera(facingMode);
    return () => {
      stopStream();
    };
  }, [facingMode, startCamera, stopStream]);

  useEffect(() => {
    return () => {
      if (lastThumbUrl) URL.revokeObjectURL(lastThumbUrl);
    };
  }, [lastThumbUrl]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0] as MediaTrackWithTorch | undefined;
    if (!track || !torchSupported) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const captureFrameBlob = async (): Promise<Blob> => {
    const stream = streamRef.current;
    const track = stream?.getVideoTracks()[0];

    // Prefer ImageCapture.takePhoto() on supported Android Chrome devices for full sensor sharpness
    const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike })
      .ImageCapture;
    if (track && typeof ImageCaptureCtor === 'function') {
      try {
        const ic = new ImageCaptureCtor(track);
        const blob = await ic.takePhoto();
        if (blob && blob.size > 0) return blob;
      } catch {
        // Fall through cleanly to video canvas frame capture
      }
    }

    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('Camera feed is not ready yet.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to capture camera frame.'))),
        'image/jpeg',
        0.93
      );
    });
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  };

  const handleShutter = async () => {
    if (!cameraReady || capturing) return;
    setCapturing(true);
    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 140);

    try {
      const blob = await captureFrameBlob();
      if (mode === 'single') {
        stopStream();
        onSingleCapture(blob);
      } else {
        setBatchBlobs((prev) => [...prev, blob]);
        const url = URL.createObjectURL(blob);
        setLastThumbUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setCapturing(false);
    }
  };

  const handleFinishBatch = () => {
    stopStream();
    onBatchComplete(batchBlobs);
  };

  const handleClose = () => {
    stopStream();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white select-none">
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

        {/* Utility Controls: Torch + Flip */}
        <div className="flex items-center gap-1.5">
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

      {/* Viewfinder Stage */}
      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        {errorMsg ? (
          <div className="w-full max-w-md mx-4 bg-white text-zinc-900 border border-zinc-300 shadow-[10px_10px_0px_0px_rgba(255,255,255,0.12)] p-6">
            <div className="h-1 w-full bg-zinc-900 -mt-6 -mx-6 mb-5 w-[calc(100%+3rem)]" />
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400 mb-2">
              // CAMERA_UNAVAILABLE
            </p>
            <p className="text-sm text-zinc-700 leading-relaxed mb-5">{errorMsg}</p>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  stopStream();
                  onFallbackGallery();
                }}
                className="w-full h-11 px-4 bg-zinc-900 text-white font-mono text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-zinc-800 cursor-pointer"
              >
                <ImagePlus size={15} />
                Import Photos
              </button>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />

            {/* HYDE Registration Bracket Overlay */}
            <div className="pointer-events-none absolute inset-6 sm:inset-10 md:inset-y-10 md:inset-x-auto md:aspect-[210/297] md:max-w-[75vw] mx-auto">
              <div className="absolute inset-0 border border-white/20" />
              <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-white" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-white" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-white" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-white" />

              {/* Subtle HYDE scanning beam */}
              <div className="absolute inset-x-2 h-px bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.85)] animate-scan-line" />

              <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap bg-zinc-950/75 px-2.5 py-1 font-mono text-[10px] tracking-widest uppercase text-zinc-300">
                {mode === 'batch'
                  ? `BATCH_MODE · ${batchBlobs.length} CAPTURED`
                  : 'ALIGN DOCUMENT INSIDE FRAME'}
              </div>
            </div>

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

      {/* Bottom Shutter Control Dock */}
      <div className="border-t border-zinc-800 bg-zinc-950 px-5 py-4 pb-safe z-20">
        <div className="mx-auto max-w-md flex items-center justify-between gap-4">
          {/* Left slot: Gallery import OR Batch thumbnail counter */}
          <div className="w-24 flex items-center justify-start">
            {batchBlobs.length > 0 && lastThumbUrl ? (
              <div className="relative flex items-center gap-2">
                <img
                  src={lastThumbUrl}
                  alt="Last captured page"
                  className="h-12 w-9 object-cover border border-white/60 bg-zinc-900"
                />
                <span className="font-mono text-xs font-bold text-white">
                  ×{batchBlobs.length}
                </span>
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
                <ImagePlus size={20} />
                <span className="font-mono text-[9px] uppercase tracking-wider">Import</span>
              </button>
            )}
          </div>

          {/* Center Shutter Button */}
          <button
            type="button"
            onClick={handleShutter}
            disabled={!cameraReady || capturing || Boolean(errorMsg)}
            aria-label="Capture document photo"
            className="relative h-16 w-16 rounded-full border-[3px] border-white p-1 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-35 cursor-pointer"
          >
            <span className="h-full w-full rounded-full bg-white flex items-center justify-center">
              <Camera size={22} className="text-zinc-950" />
            </span>
          </button>

          {/* Right slot: Done button (Batch) */}
          <div className="w-24 flex items-center justify-end">
            {batchBlobs.length > 0 && (
              <button
                type="button"
                onClick={handleFinishBatch}
                className="h-11 px-3.5 bg-white text-zinc-950 font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Check size={15} strokeWidth={3} />
                Done ({batchBlobs.length})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
