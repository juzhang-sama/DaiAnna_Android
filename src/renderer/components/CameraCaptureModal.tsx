import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Progress, Segmented, Tag, Tooltip, Typography } from 'antd';
import {
  AimOutlined,
  CheckCircleFilled,
  CloseOutlined,
  DeleteOutlined,
  FileImageOutlined,
  MoreOutlined,
  ReloadOutlined,
  RotateRightOutlined,
  ScanOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { evaluateCaptureCanvas, type CaptureQualityResult } from '../services/capture-quality';
import {
  analyzeDocumentCanvas,
  isPlausibleDocumentCorners,
  scanDocumentCanvas,
  type DocumentScanPreviewResult,
  type DocumentScanResult,
  type ScanPoint,
} from '../services/document-scan';

type CameraTuningCapabilities = MediaTrackCapabilities & {
  zoom?: {
    min: number;
    max: number;
    step?: number;
  };
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};

type CameraTuningConstraints = MediaTrackConstraintSet & {
  zoom?: number;
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
  pointsOfInterest?: Array<{ x: number; y: number }>;
};

type CameraCandidate = MediaDeviceInfo & {
  cameraIdHint: number | null;
  score: number;
};

interface ImageCaptureLike {
  takePhoto?: () => Promise<Blob>;
}

interface OverlayPoint {
  x: number;
  y: number;
}

type ScanPreviewMode = 'enhanced' | 'original';

interface AcceptedCapture {
  id: string;
  page: number;
  url: string;
  file: File;
  quality: CaptureQualityResult;
}

interface PendingCapture {
  id: string;
  page: number;
  file: File;
  url: string;
  originalFile: File;
  originalUrl: string;
  enhancedFile: File;
  enhancedUrl: string;
  previewMode: ScanPreviewMode;
  quality: CaptureQualityResult;
  scan: DocumentScanResult;
}

type CapturePhase = 'idle' | 'focusing' | 'processing';
type ScanTone = 'idle' | 'pass' | 'warn' | 'reject';

interface CameraCaptureModalProps {
  open: boolean;
  pageNumber: number;
  onCapture: (files: File[]) => void | Promise<void>;
  onClose: () => void;
  onFallback?: () => void;
}

const { Text } = Typography;

const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  open,
  pageNumber,
  onCapture,
  onClose,
  onFallback,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [quality, setQuality] = useState<CaptureQualityResult | null>(null);
  const [scan, setScan] = useState<DocumentScanResult | null>(null);
  const [liveScan, setLiveScan] = useState<DocumentScanPreviewResult | null>(null);
  const [outlinePoints, setOutlinePoints] = useState<OverlayPoint[] | null>(null);
  const [focusPoint, setFocusPoint] = useState<OverlayPoint | null>(null);
  const [sessionCaptures, setSessionCaptures] = useState<AcceptedCapture[]>([]);
  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle');
  const [error, setError] = useState('');

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      stopStream();
      setReady(false);
      setQuality(null);
      setScan(null);
      setLiveScan(null);
      setOutlinePoints(null);
      setFocusPoint(null);
      setPendingCapture((current) => {
        if (current) revokePendingCapture(current);
        return null;
      });
      setSessionCaptures((current) => {
        current.forEach(revokeAcceptedCapture);
        return [];
      });
      setCapturePhase('idle');
      setError('');
      return;
    }

    let cancelled = false;

    async function startCamera() {
      setReady(false);
      setQuality(null);
      setScan(null);
      setLiveScan(null);
      setOutlinePoints(null);
      setFocusPoint(null);
      setPendingCapture((current) => {
        if (current) revokePendingCapture(current);
        return null;
      });
      setSessionCaptures((current) => {
        current.forEach(revokeAcceptedCapture);
        return [];
      });
      setCapturePhase('idle');
      setError('');
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('当前环境不支持内置取景');
        }

        const stream = await openDocumentCameraStream();

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        await applyDocumentCameraTuning(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '相机启动失败';
        setError(msg);
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, stopStream]);

  useEffect(() => {
    if (!open || !ready || pendingCapture) return undefined;

    let frameId = 0;
    let lastAnalysisAt = 0;
    let isAnalyzing = false;
    let stopped = false;

    const analyzeFrame = (timestamp: number) => {
      frameId = window.requestAnimationFrame(analyzeFrame);
      if (stopped || isAnalyzing || timestamp - lastAnalysisAt < 620) return;

      const video = videoRef.current;
      if (!video?.videoWidth || !video.videoHeight) return;

      isAnalyzing = true;
      lastAnalysisAt = timestamp;
      try {
        const frame = captureVideoFrame(video, 860);
        const preview = analyzeDocumentCanvas(frame.canvas);
        const mappedOutline = preview.corners ? mapCornersToStage(video, frame, preview.corners) : null;
        const canShowOutline = mappedOutline &&
          shouldRenderLiveOutline(preview) &&
          isMappedOutlinePlausible(mappedOutline, guideRef.current);
        setLiveScan(preview);
        setOutlinePoints(canShowOutline ? mappedOutline : null);
      } catch (err) {
        console.info('[document-camera] preview analysis unavailable', err);
      } finally {
        isAnalyzing = false;
      }
    };

    frameId = window.requestAnimationFrame(analyzeFrame);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [open, pendingCapture, ready]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide || !ready || capturing || pendingCapture) return;

    const capturePage = pageNumber + sessionCaptures.length;
    setCapturing(true);
    try {
      setQuality(null);
      setScan(null);
      setCapturePhase('focusing');
      await triggerAutoFocus(streamRef.current);
      setCapturePhase('processing');
      const canvas = await captureDocumentSourceCanvas(video, guide, streamRef.current);
      const scanResult = scanDocumentCanvas(canvas);
      const result = mergeScanQuality(evaluateCaptureCanvas(scanResult.correctedCanvas), scanResult);
      setQuality(result);
      setScan(scanResult);

      const originalFile = await canvasToFile(scanResult.correctedCanvas, buildCameraFileName(capturePage, 'original'));
      const enhancedFile = await canvasToFile(scanResult.outputCanvas, buildCameraFileName(capturePage, 'enhanced'));
      const originalUrl = URL.createObjectURL(originalFile);
      const enhancedUrl = URL.createObjectURL(enhancedFile);
      const previewMode: ScanPreviewMode = scanResult.level === 'reject' ? 'original' : 'enhanced';
      setPendingCapture((current) => {
        if (current) revokePendingCapture(current);
        return {
          id: `${Date.now()}-${capturePage}`,
          page: capturePage,
          file: previewMode === 'original' ? originalFile : enhancedFile,
          url: previewMode === 'original' ? originalUrl : enhancedUrl,
          originalFile,
          originalUrl,
          enhancedFile,
          enhancedUrl,
          previewMode,
          quality: result,
          scan: scanResult,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '拍照失败';
      setError(msg);
    } finally {
      setCapturing(false);
      setCapturePhase('idle');
    }
  }, [capturing, pageNumber, pendingCapture, ready, sessionCaptures.length]);

  const handleStagePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || pendingCapture) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    setFocusPoint(point);
    window.setTimeout(() => setFocusPoint(null), 760);
    void focusCameraAtPoint(streamRef.current, point.x / rect.width, point.y / rect.height);
  }, [pendingCapture, ready]);

  const discardPendingCapture = useCallback(() => {
    setPendingCapture((current) => {
      if (current) revokePendingCapture(current);
      return null;
    });
    setQuality(null);
    setScan(null);
    setOutlinePoints(null);
  }, []);

  const addPendingToSession = useCallback(() => {
    if (!pendingCapture) return null;

    const accepted = pendingToAcceptedCapture(pendingCapture);
    setSessionCaptures((current) => [...current, accepted]);
    setPendingCapture(null);
    setQuality(null);
    setScan(null);
    setOutlinePoints(null);
    return accepted;
  }, [pendingCapture]);

  const removeSessionCapture = useCallback((captureId: string) => {
    setSessionCaptures((current) => {
      const target = current.find((item) => item.id === captureId);
      if (target) revokeAcceptedCapture(target);
      return current.filter((item) => item.id !== captureId);
    });
  }, []);

  const handleFinishSession = useCallback(async () => {
    let capturesToCommit = sessionCaptures;
    if (pendingCapture) {
      const accepted = pendingToAcceptedCapture(pendingCapture);
      capturesToCommit = [...sessionCaptures, accepted];
      setPendingCapture(null);
      setQuality(null);
      setScan(null);
      setOutlinePoints(null);
    }

    if (capturesToCommit.length > 0) {
      await onCapture(capturesToCommit.map((item) => item.file));
      capturesToCommit.forEach(revokeAcceptedCapture);
      setSessionCaptures([]);
    }
    onClose();
  }, [onCapture, onClose, pendingCapture, sessionCaptures]);

  const handlePreviewModeChange = useCallback((value: string | number) => {
    const mode = value === 'original' ? 'original' : 'enhanced';
    setPendingCapture((current) => {
      if (!current) return current;
      return {
        ...current,
        previewMode: mode,
        file: mode === 'original' ? current.originalFile : current.enhancedFile,
        url: mode === 'original' ? current.originalUrl : current.enhancedUrl,
      };
    });
  }, []);

  const rotatePendingCapture = useCallback(async () => {
    if (!pendingCapture) return;

    try {
      const [original, enhanced] = await Promise.all([
        rotateImageFileClockwise(pendingCapture.originalFile, buildCameraFileName(pendingCapture.page, 'original')),
        rotateImageFileClockwise(pendingCapture.enhancedFile, buildCameraFileName(pendingCapture.page, 'enhanced')),
      ]);
      const originalUrl = URL.createObjectURL(original);
      const enhancedUrl = URL.createObjectURL(enhanced);
      const mode = pendingCapture.previewMode;
      revokePendingCapture(pendingCapture);
      setPendingCapture({
        ...pendingCapture,
        originalFile: original,
        originalUrl,
        enhancedFile: enhanced,
        enhancedUrl,
        file: mode === 'original' ? original : enhanced,
        url: mode === 'original' ? originalUrl : enhancedUrl,
      });
    } catch (err) {
      console.info('[document-camera] rotate pending capture failed', err);
    }
  }, [pendingCapture]);

  const handleClose = useCallback(() => {
    if (pendingCapture) {
      revokePendingCapture(pendingCapture);
      setPendingCapture(null);
    }
    if (sessionCaptures.length > 0) {
      sessionCaptures.forEach(revokeAcceptedCapture);
      setSessionCaptures([]);
    }
    onClose();
  }, [onClose, pendingCapture, sessionCaptures]);

  const handleFallback = useCallback(() => {
    if (onFallback) {
      handleClose();
      onFallback();
    }
  }, [handleClose, onFallback]);

  const handleAddNext = useCallback(() => {
    addPendingToSession();
  }, [addPendingToSession]);

  const handleClearLiveQuality = useCallback(() => {
    setQuality(null);
    setScan(null);
  }, []);

  const handleDoneClick = useCallback(() => {
    void handleFinishSession();
  }, [handleFinishSession]);

  const handleNextClick = useCallback(() => {
    handleAddNext();
  }, [handleAddNext]);

  const handleDiscardClick = useCallback(() => {
    if (pendingCapture) {
      discardPendingCapture();
    } else {
      handleClearLiveQuality();
    }
  }, [discardPendingCapture, handleClearLiveQuality, pendingCapture]);

  if (!open) return null;

  const reviewQuality = pendingCapture?.quality ?? quality;
  const reviewScan = pendingCapture?.scan ?? scan;
  const qualityTone = reviewQuality?.level === 'pass' ? 'success' : reviewQuality?.level === 'warn' ? 'active' : 'exception';
  const liveOutlineReady = Boolean(outlinePoints);
  const scanTone = pendingCapture
    ? pendingCapture.quality.level
    : getScanTone(liveScan, reviewQuality, capturing, liveOutlineReady);
  const scanStatus = pendingCapture
    ? getPendingCaptureStatus(pendingCapture.quality)
    : getScanStatusText(liveScan, ready, error, capturing, capturePhase, reviewQuality, liveOutlineReady);
  const outlinePolygon = outlinePoints?.map((point) => `${point.x},${point.y}`).join(' ') ?? '';
  const sessionPreviewItems = [
    ...sessionCaptures.map((item, index) => ({ ...item, displayPage: pageNumber + index, pending: false })),
    ...(pendingCapture ? [{ ...pendingCapture, displayPage: pageNumber + sessionCaptures.length, pending: true }] : []),
  ];

  return (
    <div className={`camera-capture-layer camera-scan-${scanTone}`}>
      <div className="camera-capture-topbar">
        <Tooltip title="关闭">
          <Button className="camera-tool-button" shape="circle" icon={<CloseOutlined />} onClick={handleClose} />
        </Tooltip>
        <div className="camera-topbar-tools">
          <Tooltip title="闪光灯暂不可用">
            <Button className="camera-tool-button" shape="circle" icon={<ThunderboltOutlined />} disabled />
          </Tooltip>
          <Tooltip title="自动增强">
            <Button className="camera-tool-button" shape="circle" icon={<FileImageOutlined />} disabled />
          </Tooltip>
          <Tooltip title="A4 扫描">
            <Button className="camera-tool-button is-active" shape="circle" icon={<ScanOutlined />} />
          </Tooltip>
          <Tooltip title="更多">
            <Button className="camera-tool-button" shape="circle" icon={<MoreOutlined />} disabled />
          </Tooltip>
        </div>
      </div>

      <div className="camera-capture-stage" onPointerDown={handleStagePointerDown}>
        <video
          ref={videoRef}
          className={`camera-capture-video ${pendingCapture ? 'is-hidden' : ''}`}
          playsInline
          muted
        />
        {pendingCapture ? (
          <img
            className="camera-captured-review-image"
            src={pendingCapture.url}
            alt={`第 ${pageNumber + sessionCaptures.length} 页扫描结果`}
            draggable={false}
          />
        ) : (
          <div className="camera-capture-scrim" />
        )}
        {!pendingCapture && outlinePolygon && (
          <svg className="camera-detected-outline" aria-hidden="true">
            <polygon points={outlinePolygon} />
          </svg>
        )}
        {!pendingCapture && <div ref={guideRef} className={`camera-a4-guide camera-guide-${scanTone}`}>
          <div className="camera-a4-corner camera-a4-corner-tl" />
          <div className="camera-a4-corner camera-a4-corner-tr" />
          <div className="camera-a4-corner camera-a4-corner-bl" />
          <div className="camera-a4-corner camera-a4-corner-br" />
        </div>}
        {focusPoint && (
          <div
            className="camera-focus-reticle"
            style={{
              left: focusPoint.x,
              top: focusPoint.y,
            }}
          />
        )}
        <div className="camera-scan-status">
          {scanTone === 'pass' ? <CheckCircleFilled /> : <AimOutlined />}
          <span>{scanStatus}</span>
        </div>
      </div>

      <div className="camera-capture-panel">
        <div className="camera-mode-strip">
          <span className="is-active">{sessionCaptures.length > 0 ? `扫描 ${sessionCaptures.length} 张` : '扫描'}</span>
        </div>

        {reviewQuality && (
          <div className="camera-quality-card">
            {pendingCapture && (
              <div className="camera-review-controls">
                <Segmented
                  size="small"
                  value={pendingCapture.previewMode}
                  onChange={handlePreviewModeChange}
                  options={[
                    { label: '增强图', value: 'enhanced' },
                    { label: '原图', value: 'original' },
                  ]}
                />
                <Button size="small" icon={<RotateRightOutlined />} onClick={() => { void rotatePendingCapture(); }}>
                  旋转
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Text strong>{reviewQuality.level === 'pass' ? '质检通过' : '质检提示'}</Text>
              <Progress
                type="circle"
                percent={reviewQuality.score}
                size={48}
                status={qualityTone}
                strokeWidth={8}
              />
            </div>
            {reviewQuality.issues.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {reviewQuality.issues.slice(0, 4).map((issue) => (
                  <Tag key={issue} color="orange">{issue}</Tag>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
              <span>清晰 {reviewQuality.sharpness}</span>
              <span>亮度 {reviewQuality.brightness}</span>
              <span>{reviewQuality.megapixels}MP</span>
            </div>
            {reviewScan?.metrics.detected && (
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                <span>A4 {Math.round(reviewScan.metrics.coverage * 100)}%</span>
                <span>比例 {reviewScan.metrics.aspectRatio.toFixed(2)}</span>
                <span>歪斜 {Math.round(reviewScan.metrics.skew * 100)}%</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="camera-quality-card">
            <Text type="danger">{error}</Text>
            {onFallback && (
              <Button className="mt-2" block onClick={handleFallback}>
                使用系统相机
              </Button>
            )}
          </div>
        )}

        <div className="camera-capture-actions">
          <button
            className="camera-secondary-action"
            type="button"
            onClick={handleDiscardClick}
            disabled={capturing}
            aria-label="重拍"
          >
            <ReloadOutlined />
          </button>
          {pendingCapture ? (
            <button
              className="camera-next-button"
              type="button"
              onClick={handleNextClick}
            >
              下一张
            </button>
          ) : (
            <button
              className="camera-shutter-button"
              type="button"
              onClick={handleCapture}
              disabled={!ready || capturing}
              aria-label="拍摄"
            >
              <span>{capturing ? <ScanOutlined /> : null}</span>
            </button>
          )}
          <button
            className="camera-done-button"
            type="button"
            onClick={handleDoneClick}
          >
            完成
          </button>
        </div>

        {sessionPreviewItems.length > 0 && (
          <div className="camera-session-strip" aria-label="本次扫描页">
            {sessionPreviewItems.map((item) => (
              <div key={item.id} className={`camera-session-thumb ${item.pending ? 'is-pending' : ''}`}>
                <img src={item.url} alt={`第 ${item.displayPage} 页`} />
                <span>{item.displayPage}</span>
                {!item.pending && (
                  <button type="button" onClick={() => removeSessionCapture(item.id)} aria-label={`删除第 ${item.displayPage} 页`}>
                    <DeleteOutlined />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function pendingToAcceptedCapture(pending: PendingCapture): AcceptedCapture {
  if (pending.previewMode === 'original') {
    URL.revokeObjectURL(pending.enhancedUrl);
    return {
      id: pending.id,
      page: pending.page,
      file: pending.originalFile,
      url: pending.originalUrl,
      quality: pending.quality,
    };
  }

  URL.revokeObjectURL(pending.originalUrl);
  return {
    id: pending.id,
    page: pending.page,
    file: pending.enhancedFile,
    url: pending.enhancedUrl,
    quality: pending.quality,
  };
}

function revokePendingCapture(capture: PendingCapture): void {
  URL.revokeObjectURL(capture.originalUrl);
  URL.revokeObjectURL(capture.enhancedUrl);
}

function revokeAcceptedCapture(capture: AcceptedCapture): void {
  URL.revokeObjectURL(capture.url);
}

function buildCameraFileName(pageNumber: number, variant: 'original' | 'enhanced'): string {
  return `credit-report-page-${String(pageNumber).padStart(2, '0')}-${variant}.jpg`;
}

async function rotateImageFileClockwise(file: File, fileName: string): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.height;
    canvas.height = bitmap.width;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法旋转图片');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return canvasToFile(canvas, fileName);
  } finally {
    bitmap.close();
  }
}

async function applyDocumentCameraTuning(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track?.getCapabilities || !track.applyConstraints) return;

  const capabilities = track.getCapabilities() as CameraTuningCapabilities;
  const tuning: CameraTuningConstraints = {};

  if (capabilities.zoom) {
    tuning.zoom = clamp(1, capabilities.zoom.min, capabilities.zoom.max);
  }
  if (capabilities.focusMode?.includes('continuous')) {
    tuning.focusMode = 'continuous';
  }
  if (capabilities.exposureMode?.includes('continuous')) {
    tuning.exposureMode = 'continuous';
  }
  if (capabilities.whiteBalanceMode?.includes('continuous')) {
    tuning.whiteBalanceMode = 'continuous';
  }

  if (Object.keys(tuning).length === 0) return;
  await track.applyConstraints({ advanced: [tuning] }).catch(() => undefined);
}

async function triggerAutoFocus(stream: MediaStream | null): Promise<void> {
  const track = stream?.getVideoTracks()[0];
  if (!track?.getCapabilities || !track.applyConstraints) return;

  const capabilities = track.getCapabilities() as CameraTuningCapabilities;
  const mode = capabilities.focusMode?.includes('single-shot')
    ? 'single-shot'
    : capabilities.focusMode?.includes('continuous')
      ? 'continuous'
      : null;

  if (!mode) return;
  await track.applyConstraints({
    advanced: [{ focusMode: mode } as CameraTuningConstraints],
  }).catch(() => undefined);
}

async function focusCameraAtPoint(stream: MediaStream | null, x: number, y: number): Promise<void> {
  const track = stream?.getVideoTracks()[0];
  if (!track?.getCapabilities || !track.applyConstraints) return;

  const capabilities = track.getCapabilities() as CameraTuningCapabilities;
  const mode = capabilities.focusMode?.includes('single-shot')
    ? 'single-shot'
    : capabilities.focusMode?.includes('continuous')
      ? 'continuous'
      : null;

  const focus: CameraTuningConstraints = {
    pointsOfInterest: [{ x: clamp(x, 0, 1), y: clamp(y, 0, 1) }],
  };
  if (mode) focus.focusMode = mode;

  await track.applyConstraints({ advanced: [focus] }).catch(() => triggerAutoFocus(stream));
}

async function openDocumentCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前环境不支持内置取景');
  }

  const devices = await enumerateVideoDevicesWithLabels();
  const preferredDevice = selectPreferredBackCamera(devices);

  if (preferredDevice) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: buildCameraConstraints(preferredDevice.deviceId),
        audio: false,
      });
      logCameraSelection('selected', preferredDevice, stream);
      return stream;
    } catch {
      // Some Android WebViews expose labels but reject exact deviceId. Fall back below.
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: buildCameraConstraints(),
    audio: false,
  });
  logCameraSelection('fallback', preferredDevice, stream);
  return stream;
}

async function enumerateVideoDevicesWithLabels(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.some((device) => device.kind === 'videoinput' && device.label)) {
    return devices;
  }

  let probeStream: MediaStream | null = null;
  try {
    probeStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    devices = await navigator.mediaDevices.enumerateDevices();
  } finally {
    probeStream?.getTracks().forEach((track) => track.stop());
  }

  return devices;
}

function buildCameraConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    advanced: [{ zoom: 1, focusMode: 'continuous' } as CameraTuningConstraints],
  };
}

function selectPreferredBackCamera(devices: MediaDeviceInfo[]): CameraCandidate | null {
  const videoDevices = devices.filter((device) => device.kind === 'videoinput');
  if (videoDevices.length === 0) return null;

  const candidates = videoDevices.map(scoreCameraDevice);
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.cameraIdHint !== null && b.cameraIdHint !== null) return a.cameraIdHint - b.cameraIdHint;
    if (a.cameraIdHint !== null) return -1;
    if (b.cameraIdHint !== null) return 1;
    return a.label.localeCompare(b.label);
  });

  return candidates[0] ?? null;
}

function scoreCameraDevice(device: MediaDeviceInfo): CameraCandidate {
  const label = device.label.toLowerCase();
  const cameraIdHint = parseCameraIdHint(device.label) ?? parseCameraIdHint(device.deviceId);
  let score = 0;

  if (/(back|rear|environment|后置|后摄|主摄|外置)/i.test(label)) score += 100;
  if (/(front|user|前置|前摄|selfie)/i.test(label)) score -= 160;

  if (/(main|primary|主摄|wide|广角)/i.test(label)) score += 35;
  if (/(tele|telephoto|zoom|长焦|变焦)/i.test(label)) score -= 140;
  if (/(macro|micro|depth|tof|mono|微距|景深|黑白)/i.test(label)) score -= 110;
  if (/(ultra\s*wide|ultrawide|超广|超广角|0\.5x)/i.test(label)) score -= 80;

  if (cameraIdHint === 0) score += 90;
  if (cameraIdHint !== null && cameraIdHint > 1) score -= cameraIdHint * 8;

  return {
    deviceId: device.deviceId,
    groupId: device.groupId,
    kind: device.kind,
    label: device.label,
    toJSON: () => device.toJSON(),
    cameraIdHint,
    score,
  };
}

function parseCameraIdHint(value: string): number | null {
  const match = value.match(/(?:camera|camera2|cam|id|摄像头|镜头)[^0-9]*(\d+)/i) ?? value.match(/^\s*(\d+)\s*$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function logCameraSelection(reason: string, candidate: CameraCandidate | null, stream: MediaStream): void {
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.();
  console.info('[document-camera]', reason, {
    candidate: candidate ? {
      label: candidate.label,
      cameraIdHint: candidate.cameraIdHint,
      score: candidate.score,
    } : null,
    settings,
  });
}

function mergeScanQuality(quality: CaptureQualityResult, scan: DocumentScanResult): CaptureQualityResult {
  const issues = [...scan.issues, ...quality.issues];
  const score = Math.min(quality.score, scan.score);
  const level = quality.level === 'reject' || scan.level === 'reject' || score < 52
    ? 'reject'
    : quality.level === 'warn' || scan.level === 'warn' || score < 78 || issues.length > 0
      ? 'warn'
      : 'pass';

  return {
    ...quality,
    level,
    score,
    issues,
  };
}

function captureVideoFrame(video: HTMLVideoElement, maxSide: number): { canvas: HTMLCanvasElement; scale: number } {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('相机画面尚未就绪');
  }

  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法分析取景画面');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

function mapCornersToStage(
  video: HTMLVideoElement,
  frame: { canvas: HTMLCanvasElement; scale: number },
  corners: ScanPoint[],
): OverlayPoint[] {
  const videoRect = video.getBoundingClientRect();
  const stageRect = video.parentElement?.getBoundingClientRect() ?? videoRect;
  const sourceToVideoX = video.videoWidth / frame.canvas.width;
  const sourceToVideoY = video.videoHeight / frame.canvas.height;
  const displayScale = Math.max(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
  const displayedWidth = video.videoWidth * displayScale;
  const displayedHeight = video.videoHeight * displayScale;
  const offsetX = videoRect.left - stageRect.left + (videoRect.width - displayedWidth) / 2;
  const offsetY = videoRect.top - stageRect.top + (videoRect.height - displayedHeight) / 2;

  return corners.map((point) => ({
    x: offsetX + point.x * sourceToVideoX * displayScale,
    y: offsetY + point.y * sourceToVideoY * displayScale,
  }));
}

function shouldRenderLiveOutline(scan: DocumentScanPreviewResult): boolean {
  if (!scan.corners || !scan.metrics.detected) return false;
  return scan.score >= 82 &&
    isPlausibleDocumentCorners(scan.corners) &&
    scan.metrics.coverage >= 0.34 &&
    Math.abs(scan.metrics.aspectRatio - Math.SQRT2) <= 0.32 &&
    scan.metrics.skew <= 0.36;
}

function isMappedOutlinePlausible(points: OverlayPoint[], guide: HTMLElement | null): boolean {
  if (!guide || points.length !== 4) return false;

  const guideRect = guide.getBoundingClientRect();
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const ratio = height / Math.max(1, width);
  const areaRatio = (width * height) / Math.max(1, guideRect.width * guideRect.height);

  return width >= guideRect.width * 0.48 &&
    height >= guideRect.height * 0.6 &&
    areaRatio >= 0.34 &&
    ratio >= 1.05 &&
    ratio <= 2.45;
}

function getScanTone(
  scan: DocumentScanPreviewResult | null,
  quality: CaptureQualityResult | null,
  capturing: boolean,
  liveOutlineReady: boolean,
): ScanTone {
  if (quality?.level === 'reject') return 'reject';
  if (capturing) return 'warn';
  if (!scan) return 'idle';
  if (liveOutlineReady && scan.level === 'pass') return 'pass';
  if (scan.metrics.detected && scan.score >= 62) return 'warn';
  return 'idle';
}

function getScanStatusText(
  scan: DocumentScanPreviewResult | null,
  ready: boolean,
  error: string,
  capturing: boolean,
  phase: CapturePhase,
  quality: CaptureQualityResult | null,
  liveOutlineReady: boolean,
): string {
  if (error) return '相机不可用';
  if (!ready) return '启动相机';
  if (capturing && phase === 'focusing') return '正在对焦';
  if (capturing && phase === 'processing') return '正在扫描图片';
  if (quality?.level === 'reject') return '需要重拍';
  if (!scan) return '对准 A4 后拍摄';
  if (liveOutlineReady && scan.level === 'pass') return '边框已锁定';
  if (scan.metrics.detected) return '保持平稳后拍摄';
  return '对准 A4 后拍摄';
}

function getPendingCaptureStatus(quality: CaptureQualityResult): string {
  if (quality.level === 'pass') return '扫描结果待确认';
  return '请确认扫描结果';
}

async function captureDocumentSourceCanvas(
  video: HTMLVideoElement,
  guide: HTMLElement,
  stream: MediaStream | null,
): Promise<HTMLCanvasElement> {
  const stillPhoto = await takeHighResolutionPhoto(stream);
  if (stillPhoto) return stillPhoto;
  return cropGuideToCanvas(video, guide);
}

async function takeHighResolutionPhoto(stream: MediaStream | null): Promise<HTMLCanvasElement | null> {
  const track = stream?.getVideoTracks()[0];
  const ImageCaptureCtor = (window as typeof window & {
    ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike;
  }).ImageCapture;

  if (!track || !ImageCaptureCtor) return null;

  try {
    const capture = new ImageCaptureCtor(track);
    if (!capture.takePhoto) return null;
    const blob = await capture.takePhoto();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const maxSide = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 3200 / maxSide);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch (err) {
    console.info('[document-camera] high resolution photo unavailable', err);
    return null;
  }
}

function cropGuideToCanvas(video: HTMLVideoElement, guide: HTMLElement): HTMLCanvasElement {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('相机画面尚未就绪');
  }

  const videoRect = video.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  const scale = Math.max(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
  const displayedWidth = video.videoWidth * scale;
  const displayedHeight = video.videoHeight * scale;
  const offsetX = (videoRect.width - displayedWidth) / 2;
  const offsetY = (videoRect.height - displayedHeight) / 2;

  const sx = clamp((guideRect.left - videoRect.left - offsetX) / scale, 0, video.videoWidth);
  const sy = clamp((guideRect.top - videoRect.top - offsetY) / scale, 0, video.videoHeight);
  const sw = clamp(guideRect.width / scale, 1, video.videoWidth - sx);
  const sh = clamp(guideRect.height / scale, 1, video.videoHeight - sy);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法生成拍照画面');
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToFile(canvas: HTMLCanvasElement, fileName: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法保存拍摄图片'));
        return;
      }
      resolve(new File([blob], fileName, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      }));
    }, 'image/jpeg', 0.94);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default CameraCaptureModal;
