import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { message, Button, Layout, Tag, Tooltip } from 'antd';
import {
  AuditOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  FileDoneOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import PdfViewer from './components/PdfViewer';
import CreditReportTabs, { type ReportTabKey } from './components/CreditReportTabs';
import SetupModal from './components/SetupModal';
import CameraCaptureModal from './components/CameraCaptureModal';
import { CreditReport, createEmptyCreditReport } from './types/credit-report';
import { analyzeCreditReportFiles } from './services/ocr-service';
import { isImageFile } from './config/ocr-config';
import { logError } from './utils/debug-log';
import { getPlatformAdapters } from './platform';
import type { DocumentInput } from './platform';
import { evaluateCaptureQuality, type CaptureQualityResult } from './services/capture-quality';
import type { OcrQualityReport } from './parser/ocr-quality';
import type { OcrDiagnosticsReport, OcrReviewState } from './types/ocr-diagnostics';
import { validateCreditReportData } from './services/credit-report-validation';
import { standardizeImageForOcr } from './services/ocr-image-standardizer';

const { Header, Content } = Layout;

type WorkspaceSection = 'pdf' | ReportTabKey;

const NAV_ITEMS: Array<{
  key: WorkspaceSection;
  label: string;
  icon: React.ReactNode;
  requiresReport?: boolean;
}> = [
  { key: 'pdf', label: '文件解析', icon: <FilePdfOutlined /> },
  { key: 'quality', label: '质量复核', icon: <SafetyCertificateOutlined />, requiresReport: true },
  { key: 'debtAnalysis', label: '债务分析', icon: <BarChartOutlined />, requiresReport: true },
  { key: 'credit', label: '征信明细', icon: <DatabaseOutlined />, requiresReport: true },
  { key: 'query', label: '查询记录', icon: <FileSearchOutlined />, requiresReport: true },
  { key: 'assessment', label: '征信评估', icon: <AuditOutlined />, requiresReport: true },
  { key: 'provenance', label: '字段溯源', icon: <ProfileOutlined />, requiresReport: true },
];

const App: React.FC = () => {
  const platform = useMemo(() => getPlatformAdapters(), []);
  const platformAvailable = platform.available;
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [report, setReport] = useState<CreditReport>(createEmptyCreditReport());
  const [quality, setQuality] = useState<OcrQualityReport | undefined>();
  const [diagnostics, setDiagnostics] = useState<OcrDiagnosticsReport | undefined>();
  const [reviewState, setReviewState] = useState<OcrReviewState>({ reviewedIssueIds: [] });
  const [preflightQuality, setPreflightQuality] = useState<CaptureQualityResult[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('pdf');
  const [setupOpen, setSetupOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [keysReady, setKeysReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const analyzeSeqRef = useRef(0);
  const hasReport = Boolean(report.header.reportNo);
  const validation = useMemo(() => validateCreditReportData(report), [report]);
  const reviewedIds = useMemo(() => new Set(reviewState.reviewedIssueIds), [reviewState.reviewedIssueIds]);
  const pendingReviewCount = useMemo(() => (
    validation.issues.filter((issue) => (
      (issue.severity === 'critical' || issue.severity === 'warning') && !reviewedIds.has(issue.id)
    )).length
  ), [reviewedIds, validation.issues]);
  const parseTag = analyzing ? (
    <Tag color="processing" icon={<ClockCircleOutlined />}>解析中</Tag>
  ) : hasReport ? (
    <Tag color="green" icon={<CheckCircleOutlined />}>解析完成</Tag>
  ) : null;
  const reviewTag = hasReport ? (
    pendingReviewCount === 0
      ? <Tag color="blue">复核通过</Tag>
      : <Tag color="orange">待复核 {pendingReviewCount}</Tag>
  ) : null;

  useEffect(() => {
    if (!platformAvailable) return;
    platform.keyStore.hasKeys().then((has) => {
      if (!has) {
        setSetupOpen(true);
      } else {
        setKeysReady(true);
      }
    });
  }, [platform, platformAvailable]);

  useEffect(() => {
    let cancelled = false;
    if (documentFiles.length === 0 || !documentFiles.every(isImageFile)) {
      setPreflightQuality([]);
      return;
    }

    Promise.all(documentFiles.map((file) => evaluateCaptureQuality(file)))
      .then((reports) => {
        if (!cancelled) setPreflightQuality(reports);
      })
      .catch((err) => {
        logError('[preflightQuality] error:', err);
        if (!cancelled) setPreflightQuality([]);
      });

    return () => {
      cancelled = true;
    };
  }, [documentFiles]);

  const handleFilesChange = useCallback(async (
    files: File[],
    preferredPage = 1,
    options: { analyze?: boolean } = {},
  ) => {
    const shouldAnalyze = options.analyze ?? true;
    const nextFiles = files.filter(Boolean);
    if (nextFiles.length > 1 && !nextFiles.every(isImageFile)) {
      message.warning('多文件上传仅支持图片。PDF 请单独上传，图片可多张组成一套征信报告。');
      return;
    }

    const seq = analyzeSeqRef.current + 1;
    analyzeSeqRef.current = seq;
    setDocumentFiles(nextFiles);
    setCurrentPage(Math.max(1, Math.min(preferredPage, nextFiles.length || 1)));
    setReviewState({ reviewedIssueIds: [] });

    if (nextFiles.length === 0) {
      setReport(createEmptyCreditReport());
      setQuality(undefined);
      setDiagnostics(undefined);
      setAnalyzing(false);
      return;
    }

    if (!shouldAnalyze) {
      setReport(createEmptyCreditReport());
      setQuality(undefined);
      setDiagnostics(undefined);
      setAnalyzing(false);
      setActiveSection('pdf');
      return;
    }

    if (!platformAvailable) {
      message.warning('当前平台暂未接入 OCR 解析能力');
      return;
    }

    setAnalyzing(true);
    setActiveSection('debtAnalysis');

    try {
      const result = await analyzeCreditReportFiles(nextFiles);
      if (seq !== analyzeSeqRef.current) return;
      setReport(result.report);
      setQuality(result.quality);
      setDiagnostics(result.diagnostics);
      if (result.quality?.issues.length) {
        message.warning(`解析完成，存在 ${result.quality.issues.length} 项质量提示`);
      } else {
        message.success(nextFiles.length > 1 ? `已合并解析 ${nextFiles.length} 张图片` : '解析完成');
      }
    } catch (err) {
      if (seq !== analyzeSeqRef.current) return;
      logError('[analyzeCreditReportFiles] error:', err);
      message.error('解析失败，请核对文件后重试或手动填写');
    } finally {
      if (seq === analyzeSeqRef.current) {
        setAnalyzing(false);
      }
    }
  }, [platformAvailable]);

  const handleTakePhoto = useCallback(async () => {
    setCameraOpen(true);
  }, []);

  const handleNativeTakePhoto = useCallback(async () => {
    if (!platform.files) return;
    setCameraOpen(false);
    const nextPageNumber = documentFiles.length + 1;
    try {
      const input = await platform.files.takePhoto();
      const file = await documentInputToFile(input, platform.files.readAsBase64);
      const optimized = await standardizeImageForOcr(file, nextPageNumber);
      await handleFilesChange([...documentFiles, optimized], nextPageNumber, { analyze: false });
      message.success(`已加入第 ${nextPageNumber} 页，可继续拍照或点击开始解析`);
    } catch (err) {
      if (isUserCanceledNativePicker(err)) return;
      logError('[platform.takePhoto] error:', err);
      message.error('拍照失败，请重试');
    }
  }, [documentFiles, handleFilesChange, platform.files]);

  const handleCameraCapture = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const firstPageNumber = documentFiles.length + 1;
    try {
      const captured: File[] = [];
      for (let index = 0; index < files.length; index++) {
        captured.push(await standardizeImageForOcr(files[index], firstPageNumber + index));
        await nextFrame();
      }
      await handleFilesChange([...documentFiles, ...captured], firstPageNumber + captured.length - 1, { analyze: false });
      message.success(`已加入 ${captured.length} 页，可继续复核或点击开始解析`);
    } catch (err) {
      logError('[cameraCapture] error:', err);
      message.error('图片处理失败，请重拍');
    }
  }, [documentFiles, handleFilesChange]);

  const handleAnalyzeCurrentFiles = useCallback(async () => {
    if (documentFiles.length === 0) {
      message.info('请先拍照或上传征信报告');
      return;
    }
    const riskyPages = preflightQuality
      .map((item, index) => ({ item, page: index + 1 }))
      .filter(({ item }) => item.level === 'reject');
    if (riskyPages.length > 0) {
      message.warning(`有 ${riskyPages.length} 页质检风险较高，已继续解析，结果建议重点复核`);
    }
    await handleFilesChange(documentFiles, currentPage, { analyze: true });
  }, [currentPage, documentFiles, handleFilesChange, preflightQuality]);

  const handlePickPlatformFiles = useCallback(async () => {
    if (!platform.files) return;
    try {
      const inputs = await platform.files.pickFiles({ source: 'documents' });
      if (inputs.length === 0) return;
      const files: File[] = [];
      for (let index = 0; index < inputs.length; index++) {
        const file = await documentInputToFile(inputs[index], platform.files!.readAsBase64);
        files.push(isImageFile(file) ? await standardizeImageForOcr(file, index + 1) : file);
        await nextFrame();
      }
      await handleFilesChange(files, 1, { analyze: false });
      message.success(files.length === 1 && !isImageFile(files[0])
        ? '已导入 PDF，请确认后开始解析'
        : `已导入 ${files.length} 个文件，请确认顺序后开始解析`);
    } catch (err) {
      if (isUserCanceledNativePicker(err)) return;
      logError('[platform.pickFiles] error:', err);
      message.error(err instanceof Error ? err.message : '文件导入失败，请重试');
    }
  }, [handleFilesChange, platform.files]);

  const handlePickPlatformImages = useCallback(async () => {
    if (!platform.files) return;
    try {
      const inputs = await platform.files.pickFiles({ source: 'images' });
      if (inputs.length === 0) {
        message.warning('没有获取到相册图片，请重新选择');
        return;
      }
      const files: File[] = [];
      for (let index = 0; index < inputs.length; index++) {
        message.loading({
          content: `正在扫描增强第 ${index + 1}/${inputs.length} 张`,
          key: 'gallery-import',
          duration: 0,
        });
        const file = await documentInputToFile(inputs[index], platform.files.readAsBase64);
        files.push(await standardizeImageForOcr(file, index + 1));
        await nextFrame();
      }
      message.loading({ content: '图片已增强，正在解析', key: 'gallery-import', duration: 0 });
      await handleFilesChange(files, 1, { analyze: true });
      message.destroy('gallery-import');
    } catch (err) {
      message.destroy('gallery-import');
      if (isUserCanceledNativePicker(err)) return;
      logError('[platform.pickImages] error:', err);
      message.error(err instanceof Error ? err.message : '相册导入失败，请重试');
    }
  }, [handleFilesChange, platform.files]);

  const handleReportChange = useCallback((nextReport: CreditReport) => {
    setReport(nextReport);
    setReviewState({ reviewedIssueIds: [] });
  }, []);

  const handleReviewIssues = useCallback((issueIds: string[]) => {
    if (issueIds.length === 0) return;
    setReviewState((prev) => {
      const merged = new Set(prev.reviewedIssueIds);
      issueIds.forEach((issueId) => merged.add(issueId));
      return {
        reviewedIssueIds: Array.from(merged),
        reviewedAt: new Date().toISOString(),
      };
    });
    message.success(issueIds.length === 1 ? '已标记为人工复核' : `已标记 ${issueIds.length} 项为人工复核`);
  }, []);

  const handleClearReview = useCallback(() => {
    setReviewState({ reviewedIssueIds: [] });
    message.info('已清除人工复核状态');
  }, []);

  const handleOpenSourcePage = useCallback((pageIndex: number) => {
    setCurrentPage(Math.max(1, pageIndex + 1));
    setActiveSection('pdf');
    message.info(`已切换到原文第 ${pageIndex + 1} 页`);
  }, []);

  const handleNavClick = useCallback((key: WorkspaceSection) => {
    const navItem = NAV_ITEMS.find((item) => item.key === key);
    if (navItem?.requiresReport && !hasReport && !analyzing) {
      message.info('请先上传并解析征信报告');
      setActiveSection('pdf');
      return;
    }
    setActiveSection(key);
  }, [analyzing, hasReport]);

  const renderWorkspace = () => {
    if (activeSection === 'pdf') {
      return (
        <div className="h-full p-3 md:p-4">
          <PdfViewer
            files={documentFiles}
            onFilesChange={handleFilesChange}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onTakePhoto={platform.files ? handleTakePhoto : undefined}
            onPickPlatformFiles={platform.files ? handlePickPlatformFiles : undefined}
            onPickPlatformImages={platform.files ? handlePickPlatformImages : undefined}
            onAnalyzeFiles={documentFiles.length > 0 ? handleAnalyzeCurrentFiles : undefined}
            analyzing={analyzing}
            qualityReports={preflightQuality}
          />
        </div>
      );
    }

    return (
      <div className="h-full overflow-auto px-3 py-3 md:px-5 md:py-4">
        <div className="mx-auto max-w-[1680px]">
          <CreditReportTabs
            activeKey={activeSection}
            onActiveKeyChange={setActiveSection}
            report={report}
            quality={quality}
            diagnostics={diagnostics}
            reviewState={reviewState}
            loading={analyzing}
            onChange={handleReportChange}
            onReviewIssues={handleReviewIssues}
            onClearReview={handleClearReview}
            onOpenSourcePage={handleOpenSourcePage}
          />
        </div>
      </div>
    );
  };

  return (
    <Layout
      className="app-shell h-screen bg-slate-100 text-slate-900"
      style={{ display: 'flex', flexDirection: 'row' }}
    >
      <aside
        className={`app-sidebar hidden h-screen flex-none flex-col text-slate-200 transition-[width] duration-200 md:flex ${
          sidebarCollapsed ? 'w-[76px]' : 'w-[248px]'
        }`}
      >
        <div className={`border-b border-white/10 ${sidebarCollapsed ? 'px-3 py-4' : 'px-4 py-5'}`}>
          <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-3' : 'justify-between gap-3'}`}>
            <div className={`flex min-w-0 items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-teal-500 text-lg text-white shadow-sm shadow-teal-950/20">
                <FileDoneOutlined />
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-white">天才群策 · 征信贷小帮</div>
                  <div className="mt-0.5 text-xs text-slate-400">Credit intelligence v1.6</div>
                </div>
              )}
            </div>
            <Tooltip title={sidebarCollapsed ? '展开导航' : '收缩导航'} placement="right">
              <Button
                type="text"
                size="small"
                className="text-slate-300 hover:bg-white/10 hover:text-white"
                icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                aria-label={sidebarCollapsed ? '展开导航' : '收缩导航'}
              />
            </Tooltip>
          </div>
        </div>

        <nav className={`flex-1 space-y-1 py-4 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {NAV_ITEMS.map((item) => {
            const active = activeSection === item.key;
            const disabled = Boolean(item.requiresReport && !hasReport && !analyzing);
            const navButton = (
              <button
                key={item.key}
                type="button"
                className={`flex h-11 w-full items-center rounded-md text-sm transition ${
                  sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3 text-left'
                } ${
                  active
                    ? 'bg-teal-500 text-white shadow-sm shadow-teal-950/20'
                    : disabled
                      ? 'text-slate-500'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
                onClick={() => handleNavClick(item.key)}
                aria-label={item.label}
              >
                <span className="text-base">{item.icon}</span>
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
            return sidebarCollapsed ? (
              <Tooltip key={item.key} title={item.label} placement="right">
                {navButton}
              </Tooltip>
            ) : navButton;
          })}
        </nav>

        <div className={`space-y-3 border-t border-white/10 py-4 ${sidebarCollapsed ? 'px-3' : 'px-4'}`}>
          <Tooltip title="设置" placement="right">
            <Button
              block
              icon={<SettingOutlined />}
              onClick={() => setSetupOpen(true)}
              disabled={!platformAvailable}
              aria-label="设置"
            >
              {!sidebarCollapsed && '设置'}
            </Button>
          </Tooltip>
          {sidebarCollapsed ? (
            <div
              className={`mx-auto h-2 w-2 rounded-full ${keysReady ? 'bg-emerald-400' : 'bg-amber-300'}`}
              title={keysReady ? '配置可用' : '待配置'}
            />
          ) : (
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>TextIn / DeepSeek</span>
              <span className={keysReady ? 'text-emerald-400' : 'text-amber-300'}>
                {keysReady ? '可用' : '待配置'}
              </span>
            </div>
          )}
        </div>
      </aside>

      <Layout className="min-h-0 min-w-0 flex-1 bg-slate-100" style={{ minWidth: 0 }}>
        <Header
          className="app-header flex flex-none flex-col justify-center gap-3 border-b border-slate-200 px-3 py-3 md:flex-row md:items-center md:justify-between md:px-5 md:py-0"
          style={{ lineHeight: 'normal', background: '#ffffff' }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="app-header-kicker">客户档案</span>
              <span className="max-w-full truncate text-lg font-semibold text-slate-950 md:max-w-[280px]">
                {report.header.name || '未识别客户'}
              </span>
              {report.header.certNo && <Tag color="blue">本人</Tag>}
              {(parseTag || reviewTag) && (
                <span className="app-status-strip">
                  {parseTag}
                  {reviewTag}
                </span>
              )}
            </div>
          </div>

          <div className="app-header-actions flex w-full flex-none items-center gap-2 md:w-auto">
            <Button
              icon={<FilePdfOutlined />}
              onClick={() => setActiveSection('pdf')}
              disabled={documentFiles.length === 0}
              className="flex-1 md:flex-none"
            >
              切换原文
            </Button>
          </div>
        </Header>

        <Content className="app-content min-h-0 flex-1 overflow-hidden bg-slate-100">
          {renderWorkspace()}
        </Content>
      </Layout>

      <nav className="mobile-bottom-nav md:hidden" aria-label="Mobile navigation">
        <div className="mobile-bottom-nav-scroll">
          {NAV_ITEMS.map((item) => {
            const active = activeSection === item.key;
            const disabled = Boolean(item.requiresReport && !hasReport && !analyzing);
            return (
              <button
                key={item.key}
                type="button"
                className={`mobile-bottom-nav-item ${active ? 'is-active' : ''}`}
                onClick={() => handleNavClick(item.key)}
                disabled={disabled}
                aria-label={item.label}
              >
                <span className="mobile-bottom-nav-icon">{item.icon}</span>
                <span className="mobile-bottom-nav-label">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {platformAvailable && (
        <SetupModal
          open={setupOpen}
          onSuccess={() => { setSetupOpen(false); setKeysReady(true); }}
        />
      )}
      <CameraCaptureModal
        open={cameraOpen}
        pageNumber={documentFiles.length + 1}
        onCapture={handleCameraCapture}
        onClose={() => setCameraOpen(false)}
        onFallback={platform.files ? handleNativeTakePhoto : undefined}
      />
    </Layout>
  );
};

async function documentInputToFile(
  input: DocumentInput,
  readAsBase64: (input: DocumentInput) => Promise<string>,
): Promise<File> {
  const base64 = await readAsBase64(input);
  const blob = base64ToBlob(base64, input.mimeType || 'image/jpeg');
  return new File([blob], input.name || `${input.id}.jpg`, {
    type: input.mimeType || 'image/jpeg',
    lastModified: Date.now(),
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function isUserCanceledNativePicker(err: unknown): boolean {
  return nativeErrorText(err).includes('cancel');
}

function nativeErrorText(err: unknown): string {
  if (err instanceof Error) return `${err.name} ${err.message}`.toLowerCase();
  if (typeof err === 'string') return err.toLowerCase();
  if (!err || typeof err !== 'object') return '';
  const payload = err as { code?: unknown; message?: unknown; errorMessage?: unknown };
  return [payload.code, payload.message, payload.errorMessage]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64.replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export default App;
