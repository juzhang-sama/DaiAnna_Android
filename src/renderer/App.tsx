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
import { CreditReport, createEmptyCreditReport } from './types/credit-report';
import { analyzeCreditReportFiles } from './services/ocr-service';
import { isImageFile } from './config/ocr-config';
import { logError } from './utils/debug-log';
import { getPlatformAdapters } from './platform';
import type { DocumentInput } from './platform';
import type { OcrQualityReport } from './parser/ocr-quality';
import type { OcrDiagnosticsReport, OcrReviewState } from './types/ocr-diagnostics';
import { buildDebtAnalysisReport } from './services/debt-analysis-report';
import { validateCreditReportData } from './services/credit-report-validation';

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

function formatYuan(value: number): string {
  return `¥ ${Math.round(value).toLocaleString('zh-CN')}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 1000) / 10}%`;
}

const App: React.FC = () => {
  const platform = useMemo(() => getPlatformAdapters(), []);
  const platformAvailable = platform.available;
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [report, setReport] = useState<CreditReport>(createEmptyCreditReport());
  const [quality, setQuality] = useState<OcrQualityReport | undefined>();
  const [diagnostics, setDiagnostics] = useState<OcrDiagnosticsReport | undefined>();
  const [reviewState, setReviewState] = useState<OcrReviewState>({ reviewedIssueIds: [] });
  const [analyzing, setAnalyzing] = useState(false);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('pdf');
  const [setupOpen, setSetupOpen] = useState(false);
  const [keysReady, setKeysReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const analyzeSeqRef = useRef(0);
  const hasReport = Boolean(report.header.reportNo);
  const analysis = useMemo(() => buildDebtAnalysisReport(report), [report]);
  const validation = useMemo(() => validateCreditReportData(report), [report]);
  const reviewedIds = useMemo(() => new Set(reviewState.reviewedIssueIds), [reviewState.reviewedIssueIds]);
  const pendingReviewCount = useMemo(() => (
    validation.issues.filter((issue) => (
      (issue.severity === 'critical' || issue.severity === 'warning') && !reviewedIds.has(issue.id)
    )).length
  ), [reviewedIds, validation.issues]);
  const qualityScore = diagnostics?.validation.score ?? quality?.score ?? validation.score;
  const configTag = keysReady ? <Tag color="green">配置就绪</Tag> : <Tag color="gold">待配置</Tag>;
  const parseTag = analyzing
    ? <Tag color="processing" icon={<ClockCircleOutlined />}>解析中</Tag>
    : hasReport
      ? <Tag color="green" icon={<CheckCircleOutlined />}>解析完成</Tag>
      : <Tag>等待文件</Tag>;
  const reviewTag = hasReport && pendingReviewCount === 0
    ? <Tag color="blue">复核通过</Tag>
    : hasReport
      ? <Tag color="orange">待复核 {pendingReviewCount}</Tag>
      : <Tag>未开始</Tag>;

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

  const handleFilesChange = useCallback(async (files: File[], preferredPage = 1) => {
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
      setQuality(undefined);
      setDiagnostics(undefined);
      setAnalyzing(false);
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
    if (!platform.files) return;
    try {
      const input = await platform.files.takePhoto();
      const file = await documentInputToFile(input, platform.files.readAsBase64);
      await handleFilesChange([...documentFiles, file], documentFiles.length + 1);
    } catch (err) {
      logError('[platform.takePhoto] error:', err);
      message.error('拍照失败或已取消');
    }
  }, [documentFiles, handleFilesChange, platform.files]);

  const handlePickPlatformFiles = useCallback(async () => {
    if (!platform.files) return;
    try {
      const inputs = await platform.files.pickFiles();
      if (inputs.length === 0) return;
      const files = await Promise.all(
        inputs.map((input) => documentInputToFile(input, platform.files!.readAsBase64)),
      );
      await handleFilesChange(files);
    } catch (err) {
      logError('[platform.pickFiles] error:', err);
      message.error('相册导入失败或已取消');
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
        className={`hidden h-screen flex-none flex-col bg-slate-950 text-slate-200 transition-[width] duration-200 md:flex ${
          sidebarCollapsed ? 'w-[72px]' : 'w-[236px]'
        }`}
      >
        <div className={`border-b border-white/10 ${sidebarCollapsed ? 'px-3 py-4' : 'px-4 py-5'}`}>
          <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-3' : 'justify-between gap-3'}`}>
            <div className={`flex min-w-0 items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-blue-600 text-lg text-white">
                <FileDoneOutlined />
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-white">天才群策·征信贷小帮</div>
                  <div className="mt-0.5 text-xs text-slate-400">v1.6.0</div>
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
                    ? 'bg-blue-600 text-white shadow-sm'
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
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500">客户</span>
              <span className="text-base font-semibold text-slate-900">{report.header.name || '未识别客户'}</span>
              {report.header.certNo && <Tag color="blue">本人</Tag>}
              {parseTag}
              {reviewTag}
              {configTag}
            </div>
            <div className="app-header-meta mt-1 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              <span>报告编号：{report.header.reportNo || '-'}</span>
              <span>报告时间：{report.header.reportTime || '-'}</span>
              <span>OCR/校验：{hasReport ? formatPercent(qualityScore) : '-'}</span>
              <span>本月应还：{hasReport ? formatYuan(analysis.originalMonthlyPayment) : '-'}</span>
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

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64.replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export default App;
