import React, { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Spin, message } from 'antd';
import type { CreditReport } from '../types/credit-report';
import PersonalInfoTab from './tabs/PersonalInfoTab';
import CreditDetailTab from './tabs/CreditDetailTab';
import QueryRecordTab from './tabs/QueryRecordTab';
import CreditAssessmentTab from './tabs/CreditAssessmentTab';
import ProvenanceTab from './tabs/ProvenanceTab';
import OcrQualityTab from './tabs/OcrQualityTab';
import DebtAnalysisReportTab from './tabs/DebtAnalysisReportTab';
import type { OcrQualityReport } from '../parser/ocr-quality';
import type { OcrDiagnosticsReport, OcrReviewState } from '../types/ocr-diagnostics';
import { validateCreditReportData } from '../services/credit-report-validation';
import { buildReviewNavigationTarget, type ReviewNavigationTarget } from '../services/review-navigation';
import { buildInstitutionReviewIssueId, isInstitutionReviewable } from '../services/ocr-review-ids';

export type ReportTabKey =
  | 'quality'
  | 'debtAnalysis'
  | 'personal'
  | 'credit'
  | 'query'
  | 'assessment'
  | 'provenance';

interface CreditReportTabsProps {
  report: CreditReport;
  loading: boolean;
  activeKey: ReportTabKey;
  quality?: OcrQualityReport;
  diagnostics?: OcrDiagnosticsReport;
  reviewState?: OcrReviewState;
  onChange: (report: CreditReport) => void;
  onActiveKeyChange?: (key: ReportTabKey) => void;
  onReviewIssues?: (issueIds: string[]) => void;
  onClearReview?: () => void;
  onOpenSourcePage?: (pageIndex: number) => void;
}

/**
 * 征信报告主 Tab 组件
 * 按一级章节组织：个人基本信息、信贷交易信息明细、查询记录
 */
const CreditReportTabs: React.FC<CreditReportTabsProps> = ({
  report,
  loading,
  activeKey,
  quality,
  diagnostics,
  reviewState,
  onChange,
  onActiveKeyChange,
  onReviewIssues,
  onClearReview,
  onOpenSourcePage,
}) => {
  const [reviewTarget, setReviewTarget] = useState<ReviewNavigationTarget | undefined>();
  const validation = useMemo(() => validateCreditReportData(report), [report]);
  const diagnosticsForQuality = useMemo(
    () => diagnostics ? { ...diagnostics, validation } : diagnostics,
    [diagnostics, validation],
  );
  const reviewedIds = useMemo(() => new Set(reviewState?.reviewedIssueIds ?? []), [reviewState]);
  const pendingValidationCount = diagnosticsForQuality?.validation.issues.filter((issue) => (
    (issue.severity === 'critical' || issue.severity === 'warning') && !reviewedIds.has(issue.id)
  )).length ?? 0;
  const institutionAttentionCount = diagnosticsForQuality?.institutionCorrections?.filter((item, index) => (
    isInstitutionReviewable(item) && !reviewedIds.has(buildInstitutionReviewIssueId(item, index))
  )).length ?? 0;
  const reviewCount = (quality?.issues.length ?? 0) + pendingValidationCount + institutionAttentionCount;

  const handleOpenIssue = useCallback((field: string) => {
    const target = {
      ...buildReviewNavigationTarget(field),
      focusToken: Date.now(),
    };
    setReviewTarget(target);
    onActiveKeyChange?.(target.destinationTab);
    message.info(`已定位到${TAB_LABEL[target.destinationTab]}：${target.label}`);
  }, [onActiveKeyChange]);

  const items: Record<ReportTabKey, {
    key: ReportTabKey;
    label: string;
    eyebrow: string;
    description: string;
    badge?: number;
    children: React.ReactNode;
  }> = {
    quality: {
      key: 'quality',
      label: '质量复核',
      eyebrow: 'OCR Review',
      description: '先核对高风险字段、金额一致性和机构库匹配，再进入报告导出或 AI 分析。',
      badge: reviewCount,
      children: (
        <OcrQualityTab
          quality={quality}
          diagnostics={diagnosticsForQuality}
          reviewState={reviewState}
          onReviewIssues={onReviewIssues}
          onClearReview={onClearReview}
          onOpenIssue={handleOpenIssue}
          onOpenSourcePage={onOpenSourcePage}
          getFieldSourcePage={(field) => findFieldSourcePage(report, field)}
        />
      ),
    },
    debtAnalysis: {
      key: 'debtAnalysis',
      label: '债务分析',
      eyebrow: 'Debt Command',
      description: '围绕债务结构、本月应还、复核阻断和方案对比组织顾问决策。',
      children: <DebtAnalysisReportTab report={report} diagnostics={diagnostics} reviewState={reviewState} />,
    },
    personal: {
      key: 'personal',
      label: '个人基本信息',
      eyebrow: 'Identity',
      description: '报告头与身份字段可直接编辑，后续分析会使用这里的修正结果。',
      children: <PersonalInfoTab report={report} onChange={onChange} reviewTarget={reviewTarget} />,
    },
    credit: {
      key: 'credit',
      label: '征信明细',
      eyebrow: 'Credit Detail',
      description: '按账户类型核对管理机构、状态、余额、本月应还和还款日。',
      children: <CreditDetailTab report={report} onChange={onChange} reviewTarget={reviewTarget} />,
    },
    query: {
      key: 'query',
      label: '查询记录',
      eyebrow: 'Query Records',
      description: '查看机构查询、本人查询和查询原因，用于判断近期查询压力。',
      children: <QueryRecordTab report={report} onChange={onChange} reviewTarget={reviewTarget} />,
    },
    assessment: {
      key: 'assessment',
      label: '征信评估',
      eyebrow: 'Risk Assessment',
      description: '以客观事实维度展示硬伤、负债、查询和信用历史风险。',
      children: <CreditAssessmentTab report={report} />,
    },
    provenance: {
      key: 'provenance',
      label: '字段溯源',
      eyebrow: 'Provenance',
      description: '追踪关键字段来源，辅助人工回查原始页和原始表格。',
      children: <ProvenanceTab report={report} />,
    },
  };

  const current = items[activeKey] ?? items.debtAnalysis;

  return (
    <Spin spinning={loading} description="正在解析征信报告...">
      <div className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{current.eyebrow}</div>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="m-0 text-xl font-semibold text-slate-950">{current.label}</h1>
              {Boolean(current.badge) && <Badge count={current.badge} />}
            </div>
            <p className="m-0 mt-1 max-w-3xl text-sm text-slate-500">{current.description}</p>
          </div>
          {activeKey !== 'quality' && reviewCount > 0 && (
            <Button onClick={() => onActiveKeyChange?.('quality')}>
              查看 {reviewCount} 项复核
            </Button>
          )}
        </header>

        <div className="min-h-[500px]">
          {current.children}
        </div>
      </div>
    </Spin>
  );
};

const TAB_LABEL: Record<ReportTabKey, string> = {
  personal: '个人基本信息',
  credit: '信贷交易信息明细',
  query: '查询记录',
  quality: '解析质量',
  debtAnalysis: '数据分析报告',
  assessment: '征信评估',
  provenance: '字段溯源',
};

function findFieldSourcePage(report: CreditReport, field: string): number | undefined {
  const direct = report.provenance[field];
  if (direct?.pageNum !== undefined) return direct.pageNum;

  const creditDetailField = report.provenance[`creditDetail.${field}`];
  if (creditDetailField?.pageNum !== undefined) return creditDetailField.pageNum;

  const listPrefix = field.replace(/\[[0-9]+\]\.[^.]+$/, '');
  const moduleSource = report.provenance[`creditDetail.${listPrefix}`] ?? report.provenance[listPrefix];
  if (moduleSource?.pageNum !== undefined) return moduleSource.pageNum;

  const accountOrgSource = report.provenance[`creditDetail.${field.replace(/\.[^.]+$/, '.org')}`];
  if (accountOrgSource?.pageNum !== undefined) return accountOrgSource.pageNum;

  return undefined;
}

export default CreditReportTabs;
