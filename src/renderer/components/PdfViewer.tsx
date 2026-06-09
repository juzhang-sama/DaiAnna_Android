import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Space, Spin, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import {
  CheckCircleOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  DownOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  InboxOutlined,
  LeftOutlined,
  RightOutlined,
  RotateRightOutlined,
  SafetyCertificateOutlined,
  UpOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
} from '@ant-design/icons';
import * as pdfjsLib from 'pdfjs-dist';
import { isImageFile, UPLOAD_ACCEPT } from '../config/ocr-config';
import { logError } from '../utils/debug-log';
import type { CaptureQualityResult } from '../services/capture-quality';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

interface PdfViewerProps {
  files: File[];
  onFilesChange: (files: File[], preferredPage?: number, options?: { analyze?: boolean }) => void;
  currentPage: number;
  onPageChange: (page: number) => void;
  showImageOrderPanel?: boolean;
  onTakePhoto?: () => void;
  onPickPlatformFiles?: () => void;
  onPickPlatformImages?: () => void;
  onAnalyzeFiles?: () => void;
  analyzing?: boolean;
  qualityReports?: CaptureQualityResult[];
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.25;

type ImageSize = {
  width: number;
  height: number;
};

const PdfViewer: React.FC<PdfViewerProps> = ({
  files,
  onFilesChange,
  currentPage,
  onPageChange,
  showImageOrderPanel = true,
  onTakePhoto,
  onPickPlatformFiles,
  onPickPlatformImages,
  onAnalyzeFiles,
  analyzing = false,
  qualityReports = [],
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTask = useRef<any>(null);
  const uploadTimer = useRef<number | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [pageRendering, setPageRendering] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageNaturalSize, setImageNaturalSize] = useState<ImageSize | null>(null);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});

  const firstFile = files[0] ?? null;
  const isImageSet = files.length > 0 && files.every(isImageFile);
  const isPdfMode = files.length === 1 && Boolean(firstFile) && !isImageSet;
  const currentImageUrl = isImageSet ? imageUrls[currentPage - 1] : null;
  const currentRotation = pageRotations[currentPage] ?? 0;
  const currentFileName = isImageSet
    ? files[currentPage - 1]?.name ?? files[0]?.name
    : firstFile?.name;
  const isQuarterTurn = currentRotation % 180 !== 0;
  const preflightRejectCount = qualityReports.filter((item) => item.level === 'reject').length;
  const preflightWarnCount = qualityReports.filter((item) => item.level === 'warn').length;
  const preflightIssues = qualityReports.flatMap((item, index) => (
    item.issues.slice(0, 2).map((issue) => `第 ${index + 1} 页：${issue}`)
  ));
  const imageDisplaySize = imageNaturalSize
    ? {
        width: imageNaturalSize.width * scale,
        height: imageNaturalSize.height * scale,
      }
    : null;
  const imageSurfaceSize = imageDisplaySize
    ? {
        width: isQuarterTurn ? imageDisplaySize.height : imageDisplaySize.width,
        height: isQuarterTurn ? imageDisplaySize.width : imageDisplaySize.height,
      }
    : null;

  const scheduleUpload: UploadProps['beforeUpload'] = (_file, fileList) => {
    const selectedFiles = fileList.map((item) => item as File);
    if (uploadTimer.current) {
      window.clearTimeout(uploadTimer.current);
    }
    uploadTimer.current = window.setTimeout(() => {
      onFilesChange(selectedFiles, undefined, { analyze: true });
      uploadTimer.current = null;
    }, 0);
    return false;
  };

  useEffect(() => () => {
    if (uploadTimer.current) {
      window.clearTimeout(uploadTimer.current);
    }
  }, []);

  useEffect(() => {
    if (!isImageSet) {
      setImageUrls([]);
      setImageNaturalSize(null);
      return;
    }

    const urls = files.map((file) => URL.createObjectURL(file));
    setPdfDoc(null);
    setTotalPages(files.length);
    setScale(1);
    setImageNaturalSize(null);
    setPageRotations({});
    setImageUrls(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files, isImageSet]);

  useEffect(() => {
    if (!isPdfMode || !firstFile) {
      if (!isPdfMode) setPdfDoc(null);
      return;
    }

    let canceled = false;
    setImageUrls([]);
    setImageNaturalSize(null);
    setPageRotations({});
    setPageRendering(true);

    const loadDoc = async () => {
      try {
        const arrayBuffer = await firstFile.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const doc = await loadingTask.promise;
        if (canceled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setScale(1);
        onPageChange(1);
      } catch (err) {
        if (!canceled) {
          logError('Error loading PDF:', err);
        }
      } finally {
        if (!canceled) {
          setPageRendering(false);
        }
      }
    };

    loadDoc();
    return () => {
      canceled = true;
    };
  }, [firstFile, isPdfMode, onPageChange]);

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      onPageChange(totalPages);
    }
  }, [currentPage, onPageChange, totalPages]);

  useEffect(() => {
    if (files.length === 0) {
      setPageRotations({});
      setImageNaturalSize(null);
    }
  }, [files.length]);

  useEffect(() => {
    setImageNaturalSize(null);
  }, [currentImageUrl]);

  const fitToWidth = useCallback(async () => {
    if (isImageSet) {
      if (!imageNaturalSize || !containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth - 48;
      const pageWidth = isQuarterTurn ? imageNaturalSize.height : imageNaturalSize.width;
      if (containerWidth > 0 && pageWidth > 0) {
        setScale(Math.max(MIN_SCALE, Math.min(containerWidth / pageWidth, MAX_SCALE)));
      }
      return;
    }
    if (!pdfDoc || !containerRef.current) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const unscaledViewport = page.getViewport({ scale: 1.0, rotation: currentRotation });
      const containerWidth = containerRef.current.clientWidth - 48;
      if (containerWidth > 0 && unscaledViewport.width > 0) {
        setScale(Math.max(MIN_SCALE, Math.min(containerWidth / unscaledViewport.width, MAX_SCALE)));
      }
    } catch (err) {
      logError('fitToWidth error:', err);
    }
  }, [currentPage, currentRotation, imageNaturalSize, isImageSet, isQuarterTurn, pdfDoc]);

  const fitToPage = useCallback(async () => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth - 48;
    const containerHeight = containerRef.current.clientHeight - 48;
    if (containerWidth <= 0 || containerHeight <= 0) return;

    if (isImageSet) {
      if (!imageNaturalSize) return;
      const pageWidth = isQuarterTurn ? imageNaturalSize.height : imageNaturalSize.width;
      const pageHeight = isQuarterTurn ? imageNaturalSize.width : imageNaturalSize.height;
      if (pageWidth > 0 && pageHeight > 0) {
        const nextScale = Math.min(containerWidth / pageWidth, containerHeight / pageHeight);
        setScale(Math.max(MIN_SCALE, Math.min(nextScale, MAX_SCALE)));
      }
      return;
    }

    if (!pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.0, rotation: currentRotation });
      if (viewport.width > 0 && viewport.height > 0) {
        const nextScale = Math.min(containerWidth / viewport.width, containerHeight / viewport.height);
        setScale(Math.max(MIN_SCALE, Math.min(nextScale, MAX_SCALE)));
      }
    } catch (err) {
      logError('fitToPage error:', err);
    }
  }, [currentPage, currentRotation, imageNaturalSize, isImageSet, isQuarterTurn, pdfDoc]);

  useEffect(() => {
    if (pdfDoc) {
      fitToWidth();
    }
  }, [fitToWidth, pdfDoc]);

  useEffect(() => {
    if (isImageSet && imageNaturalSize) {
      fitToPage();
    }
  }, [fitToPage, imageNaturalSize, isImageSet]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    const render = async () => {
      if (renderTask.current) {
        renderTask.current.cancel();
      }
      setPageRendering(true);

      try {
        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale, rotation: currentRotation });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const task = page.render({ canvasContext: context, viewport, canvas });
        renderTask.current = task;
        await task.promise;
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          logError('Error rendering page:', err);
        }
      } finally {
        setPageRendering(false);
      }
    };

    render();
  }, [currentPage, currentRotation, pdfDoc, scale]);

  const handleZoomIn = () => setScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  const handleZoomOut = () => setScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  const handlePrev = () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  };
  const handleNext = () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  };
  const handleRotatePage = () => {
    setPageRotations((prev) => ({
      ...prev,
      [currentPage]: ((prev[currentPage] ?? 0) + 90) % 360,
    }));
  };
  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setImageNaturalSize({ width: naturalWidth, height: naturalHeight });
    }
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const nextFiles = [...files];
    const [item] = nextFiles.splice(index, 1);
    nextFiles.splice(target, 0, item);
    onFilesChange(nextFiles, target + 1, { analyze: false });
  };

  const removeImage = (index: number) => {
    const nextFiles = files.filter((_, fileIndex) => fileIndex !== index);
    const nextPage = Math.max(1, Math.min(currentPage, nextFiles.length));
    onFilesChange(nextFiles, nextPage, { analyze: false });
  };

  const imageSurfaceStyle: React.CSSProperties | undefined = currentImageUrl && imageSurfaceSize
    ? {
        width: imageSurfaceSize.width,
        height: Math.max(500, imageSurfaceSize.height),
      }
    : undefined;
  const imageElementStyle: React.CSSProperties = imageDisplaySize
    ? {
        width: imageDisplaySize.width,
        height: imageDisplaySize.height,
        maxWidth: 'none',
        transform: `rotate(${currentRotation}deg)`,
        transformOrigin: 'center center',
      }
    : {
        maxWidth: '100%',
        transform: `rotate(${currentRotation}deg) scale(${scale})`,
        transformOrigin: 'center center',
      };

  if (files.length === 0) {
    return (
      <div className="grid h-full min-h-0 grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {onTakePhoto && (
              <Button className="home-action-button" type="primary" size="large" icon={<FileImageOutlined />} onClick={onTakePhoto}>
                  拍照解析
                </Button>
              )}
            {onPickPlatformFiles ? (
              <Button className="home-action-button" type="primary" size="large" icon={<FilePdfOutlined />} onClick={onPickPlatformFiles}>
                  文件导入
                </Button>
            ) : (
              <Upload className="home-action-upload" accept={UPLOAD_ACCEPT} multiple showUploadList={false} beforeUpload={scheduleUpload}>
                <Button className="home-action-button" type="primary" size="large" icon={<FilePdfOutlined />}>
                  文件导入
                </Button>
              </Upload>
              )}
              {onPickPlatformImages && (
              <Button className="home-action-button" type="primary" size="large" icon={<FileImageOutlined />} onClick={onPickPlatformImages}>
                  相册导入
                </Button>
              )}
            </div>

          <Upload.Dragger
            accept={UPLOAD_ACCEPT}
            multiple
            openFileDialogOnClick={false}
            showUploadList={false}
            beforeUpload={scheduleUpload}
            className="min-h-0 flex-1"
            style={{ background: '#f8fafc', border: '1px dashed #99f6e4' }}
          >
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-5 py-8 text-center sm:min-h-[520px] sm:px-8 sm:py-14">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-teal-50 text-3xl text-teal-600 sm:mb-6 sm:h-16 sm:w-16 sm:text-4xl">
                <InboxOutlined />
              </div>
              <h1 className="m-0 text-xl font-semibold text-slate-950 sm:text-2xl">导入征信报告</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
                使用上方任一方式开始。也可以将 PDF 或图片直接拖放到此处。
              </p>
            </div>
          </Upload.Dragger>
        </div>

        <aside className="hidden min-h-0 flex-col rounded-lg border border-slate-200 bg-slate-50 xl:flex">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">解析流程</div>
            <div className="mt-1 text-xs text-slate-500">每一步结果都会进入复核链路</div>
          </div>
          <div className="flex-1 space-y-4 p-4">
            {[
              ['1', '上传原文', 'PDF 或多张图片进入同一份报告'],
              ['2', 'OCR 结构化', '识别表格、账户、金额和查询记录'],
              ['3', '质量复核', '高风险字段、机构库、金额一致性'],
              ['4', '分析报告', '债务分析、AI 建议、Word 报告'],
            ].map(([step, title, desc]) => (
              <div key={step} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white text-xs font-semibold text-blue-600 ring-1 ring-slate-200">
                  {step}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">{title}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
            <CheckCircleOutlined className="mr-1 text-emerald-500" />
            产品匹配功能已下线，不会进入当前流程。
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="pdf-toolbar z-10 flex flex-none flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 py-2 shadow-sm sm:gap-3 sm:px-3">
        <Typography.Text className="min-w-[140px] max-w-sm flex-1 truncate text-sm font-medium text-gray-700" title={currentFileName}>
          {isImageSet && files.length > 1 ? `${files.length} 张图片 · ${currentFileName}` : currentFileName}
        </Typography.Text>
        <Space size="small" wrap>
          <Tooltip title="适应整页">
            <Button icon={<FullscreenOutlined />} onClick={fitToPage} />
          </Tooltip>
          <Tooltip title="适应宽度">
            <Button icon={<ColumnWidthOutlined />} onClick={fitToWidth} />
          </Tooltip>
          <Tooltip title="当前页顺时针旋转 90 度">
            <Button icon={<RotateRightOutlined />} onClick={handleRotatePage} />
          </Tooltip>
          <Space size="small">
            <Tooltip title="缩小">
              <Button icon={<ZoomOutOutlined />} onClick={handleZoomOut} />
            </Tooltip>
            <span className="text-sm w-12 text-center inline-block">{Math.round(scale * 100)}%</span>
            <Tooltip title="放大">
              <Button icon={<ZoomInOutlined />} onClick={handleZoomIn} />
            </Tooltip>
          </Space>
          <Space size="small">
            <Tooltip title="上一页">
              <Button icon={<LeftOutlined />} onClick={handlePrev} disabled={currentPage <= 1} />
            </Tooltip>
            <span className="text-sm">第 {currentPage} 页 / 共 {totalPages} 页</span>
            <Tooltip title="下一页">
              <Button icon={<RightOutlined />} onClick={handleNext} disabled={currentPage >= totalPages} />
            </Tooltip>
          </Space>
        </Space>
        <Upload accept={UPLOAD_ACCEPT} multiple showUploadList={false} beforeUpload={scheduleUpload}>
          <Button type="primary" ghost>重新上传</Button>
        </Upload>
        {onAnalyzeFiles && (
          <Button
            type="primary"
            icon={<SafetyCertificateOutlined />}
            onClick={onAnalyzeFiles}
            loading={analyzing}
            disabled={files.length === 0}
          >
            开始解析
          </Button>
        )}
        {(onTakePhoto || onPickPlatformFiles || onPickPlatformImages) && (
          <Space size="small">
            {onTakePhoto && <Button onClick={onTakePhoto}>拍照</Button>}
            {onPickPlatformFiles && <Button onClick={onPickPlatformFiles}>文件</Button>}
            {onPickPlatformImages && <Button onClick={onPickPlatformImages}>相册</Button>}
          </Space>
        )}
      </div>

      {qualityReports.length > 0 && (
        <div className="flex-none border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Tag color={preflightRejectCount > 0 ? 'red' : preflightWarnCount > 0 ? 'orange' : 'green'}>
              解析前质检：{qualityReports.length - preflightRejectCount - preflightWarnCount}/{qualityReports.length} 通过
            </Tag>
            {preflightRejectCount > 0 && <Tag color="red">{preflightRejectCount} 页建议重拍</Tag>}
            {preflightWarnCount > 0 && <Tag color="orange">{preflightWarnCount} 页需确认</Tag>}
            {preflightIssues.slice(0, 3).map((issue) => (
              <span key={issue} className="rounded bg-slate-100 px-2 py-1">{issue}</span>
            ))}
          </div>
        </div>
      )}

      {showImageOrderPanel && isImageSet && files.length > 1 && (
        <div className="flex-none overflow-x-auto border-b border-gray-200 bg-white px-2 py-2 lg:hidden">
          <div className="flex gap-2">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${file.lastModified}-${index}`}
                className={`flex w-36 flex-none items-center gap-2 rounded-md border p-2 ${
                  currentPage === index + 1 ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onPageChange(index + 1)}
                  title={file.name}
                >
                  <div className="text-xs text-gray-500">第 {index + 1} 页</div>
                  <div className="truncate text-xs text-gray-800">{file.name}</div>
                </button>
                <Space size={2}>
                  <Button size="small" icon={<UpOutlined />} disabled={index === 0} onClick={() => moveImage(index, -1)} />
                  <Button size="small" icon={<DownOutlined />} disabled={index === files.length - 1} onClick={() => moveImage(index, 1)} />
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeImage(index)} />
                </Space>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showImageOrderPanel && isImageSet && files.length > 1 && (
          <aside className="hidden w-56 flex-none overflow-auto border-r border-gray-200 bg-white lg:block">
            <div className="px-4 py-3 border-b border-gray-100">
              <Typography.Text strong>图片页序</Typography.Text>
              <div className="text-xs text-gray-500 mt-1">OCR 将按此顺序合并解析</div>
            </div>
            <div className="p-2 space-y-2">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${file.lastModified}-${index}`}
                  className={`flex items-center gap-2 rounded-md border px-2 py-2 ${
                    currentPage === index + 1 ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <Button
                    size="small"
                    type={currentPage === index + 1 ? 'primary' : 'text'}
                    icon={<FileImageOutlined />}
                    onClick={() => onPageChange(index + 1)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onPageChange(index + 1)}
                    title={file.name}
                  >
                    <div className="text-xs text-gray-500">第 {index + 1} 页</div>
                    <div className="truncate text-sm text-gray-800">{file.name}</div>
                  </button>
                  <Space size={2}>
                    <Button size="small" icon={<UpOutlined />} disabled={index === 0} onClick={() => moveImage(index, -1)} />
                    <Button size="small" icon={<DownOutlined />} disabled={index === files.length - 1} onClick={() => moveImage(index, 1)} />
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeImage(index)} />
                  </Space>
                </div>
              ))}
            </div>
          </aside>
        )}

        <div ref={containerRef} className="flex flex-1 justify-center overflow-auto bg-slate-200 p-2 scroll-smooth sm:p-4">
          <div
            className="relative flex min-h-[500px] items-center justify-center bg-white shadow-lg ring-1 ring-slate-300/60"
            style={imageSurfaceStyle}
          >
            {pageRendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                <Spin description="正在渲染..." size="large" />
              </div>
            )}
            {currentImageUrl ? (
              <img
                src={currentImageUrl}
                alt={currentFileName}
                draggable={false}
                onLoad={handleImageLoad}
                style={imageElementStyle}
              />
            ) : (
              <canvas ref={canvasRef} className={pageRendering ? 'invisible' : 'visible'} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PdfViewer;
