import React from 'react';
import { Alert, Button, Collapse, Progress, Table, Tag, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CheckOutlined,
  ClearOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { OcrQualityReport } from '../../parser/ocr-quality';
import type {
  CreditReportValidationIssue,
  CreditReportValidationReport,
  InstitutionCorrectionDiagnostic,
  OcrDiagnosticsReport,
  OcrReviewState,
} from '../../types/ocr-diagnostics';
import { buildReviewNavigationTarget } from '../../services/review-navigation';
import { buildInstitutionReviewIssueId, isInstitutionReviewable } from '../../services/ocr-review-ids';

interface OcrQualityTabProps {
  quality?: OcrQualityReport;
  diagnostics?: OcrDiagnosticsReport;
  reviewState?: OcrReviewState;
  onReviewIssues?: (issueIds: string[]) => void;
  onClearReview?: () => void;
  onOpenIssue?: (field: string) => void;
  onOpenSourcePage?: (pageIndex: number) => void;
  getFieldSourcePage?: (field: string) => number | undefined;
}

type TileTone = 'default' | 'danger' | 'warning' | 'success' | 'info';

function formatPercent(score: number): number {
  return Math.round(score * 100);
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

function getScoreStatus(score: number): 'success' | 'normal' | 'exception' {
  if (score >= 0.9) return 'success';
  if (score >= 0.75) return 'normal';
  return 'exception';
}

function getAlertType(quality: OcrQualityReport): 'success' | 'warning' | 'error' {
  if (quality.score < 0.75) return 'error';
  if (quality.issues.length > 0) return 'warning';
  return 'success';
}

function getAlertMessage(quality: OcrQualityReport): string {
  if (quality.score < 0.75) return 'OCR 识别质量偏低，建议复核后再用于分析';
  if (quality.scope.type === 'fragment' && quality.issues.length === 0) return '已按片段模式完成解析';
  if (quality.issues.length > 0) return `OCR 结构可用，存在 ${quality.issues.length} 项需复核提示`;
  return 'OCR 识别质量良好';
}

function getProfileLabel(quality: OcrQualityReport): string {
  if (quality.profile === 'pboc-personal-detailed') return '本人详版';
  if (quality.profile === 'pboc-personal-fragment') return '本人详版片段';
  return '未知';
}

function getProfileColor(quality: OcrQualityReport): string {
  if (quality.profile === 'pboc-personal-detailed') return 'green';
  if (quality.profile === 'pboc-personal-fragment') return 'blue';
  return 'gold';
}

function getScopeColor(type: OcrQualityReport['scope']['type']): string {
  if (type === 'complete') return 'green';
  if (type === 'fragment') return 'blue';
  return 'gold';
}

const INSTITUTION_STATUS_COLOR: Record<InstitutionCorrectionDiagnostic['status'], string> = {
  matched: 'green',
  review: 'orange',
  unlisted: 'red',
};

function getInstitutionStatusLabel(item: InstitutionCorrectionDiagnostic): string {
  if (item.statusLabel) return item.statusLabel;
  if (item.status === 'matched') return item.matchType === 'fuzzy' ? '经机构库模糊匹配' : '经机构库匹配';
  if (item.status === 'review') return '疑似机构，请复核';
  return '该机构未被收录';
}

function formatInstitutionSource(item: InstitutionCorrectionDiagnostic): string {
  const parts: string[] = [];
  if (item.sourceLabel) parts.push(item.sourceLabel);
  if (item.pageNum !== undefined) parts.push(`物理页 ${item.pageNum + 1}`);
  if (item.logicalPage !== undefined) parts.push(`征信页 ${item.logicalPage}`);
  if (item.precedingText) parts.push(item.precedingText);
  return parts.join(' / ') || '-';
}

function isReviewableSeverity(severity: string): boolean {
  return severity === 'critical' || severity === 'warning';
}

function needsInstitutionReview(item: InstitutionCorrectionDiagnostic): boolean {
  return isInstitutionReviewable(item);
}

const OcrQualityTab: React.FC<OcrQualityTabProps> = ({
  quality,
  diagnostics,
  reviewState,
  onReviewIssues,
  onClearReview,
  onOpenIssue,
  onOpenSourcePage,
  getFieldSourcePage,
}) => {
  if (!quality && !diagnostics) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <Alert
          type="info"
          showIcon
          title="暂无 OCR 质量报告"
          description="电子版文本直提或尚未运行 OCR 时，不会生成 OCR 识别质量报告。"
        />
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <ReviewOverview
        quality={quality}
        diagnostics={diagnostics}
        reviewState={reviewState}
        onReviewIssues={onReviewIssues}
        onClearReview={onClearReview}
      />
      <ReviewStatusBanner quality={quality} diagnostics={diagnostics} reviewState={reviewState} />
      {diagnostics ? (
        renderDiagnostics(
          diagnostics,
          reviewState,
          onReviewIssues,
          onClearReview,
          onOpenIssue,
          onOpenSourcePage,
          getFieldSourcePage,
        )
      ) : (
        <Alert
          type="info"
          showIcon
          title="暂无字段与金额复核清单"
          description="当前只有 OCR 识别质量信息，字段级校验结果尚未生成。"
        />
      )}
    </div>
  );
};

const ReviewOverview: React.FC<{
  quality?: OcrQualityReport;
  diagnostics?: OcrDiagnosticsReport;
  reviewState?: OcrReviewState;
  onReviewIssues?: (issueIds: string[]) => void;
  onClearReview?: () => void;
}> = ({ quality, diagnostics, reviewState, onReviewIssues, onClearReview }) => {
  const validation = diagnostics?.validation;
  const reviewedIds = new Set(reviewState?.reviewedIssueIds ?? []);
  const validationIssues = validation?.issues ?? [];
  const reviewableIssues = validationIssues.filter((issue) => isReviewableSeverity(issue.severity));
  const reviewedCount = reviewableIssues.filter((issue) => reviewedIds.has(issue.id)).length;
  const pendingCriticalCount = validationIssues.filter((issue) => issue.severity === 'critical' && !reviewedIds.has(issue.id)).length;
  const unreviewedValidationIds = reviewableIssues.filter((issue) => !reviewedIds.has(issue.id)).map((issue) => issue.id);
  const unreviewedInstitutionIds = (diagnostics?.institutionCorrections ?? [])
    .map((item, index) => ({ item, id: buildInstitutionReviewIssueId(item, index) }))
    .filter(({ item, id }) => needsInstitutionReview(item) && !reviewedIds.has(id))
    .map(({ id }) => id);
  const unreviewedIds = [...unreviewedValidationIds, ...unreviewedInstitutionIds];
  const institutionReviewCount = unreviewedInstitutionIds.length;
  const imageIssueCount =
    (diagnostics?.images ?? []).reduce((count, item) => count + item.issues.length, 0) +
    (diagnostics?.processing ?? []).reduce((count, item) => count + item.issues.length, 0);
  const status = getOverviewStatus(validation, unreviewedIds.length, institutionReviewCount, pendingCriticalCount);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Review Center</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-lg font-semibold text-slate-950">复核结果总览</h2>
            <Tag color={status.color} icon={status.icon}>{status.label}</Tag>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {quality ? (
              <>
                <Tag color={getProfileColor(quality)}>{getProfileLabel(quality)}</Tag>
                <Tag color={getScopeColor(quality.scope.type)}>{quality.scope.label}</Tag>
              </>
            ) : (
              <Tag color="blue">电子版文本直提</Tag>
            )}
            {validation && (
              <Tag color={validation.requiresReview ? 'gold' : 'green'}>
                字段校验 {formatPercent(validation.score)}%
              </Tag>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {unreviewedIds.length > 0 && onReviewIssues && (
            <Button type="primary" icon={<CheckOutlined />} onClick={() => onReviewIssues(unreviewedIds)}>
              全部复核
            </Button>
          )}
          {reviewedCount > 0 && onClearReview && (
            <Button icon={<ClearOutlined />} onClick={onClearReview}>
              清除状态
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        <ScoreTile label="字段校验" score={validation?.score ?? null} />
        <ScoreTile label="识别质量" score={quality?.score ?? null} />
        <MetricTile
          label="待复核"
          value={unreviewedIds.length}
          tone={unreviewedIds.length > 0 ? 'warning' : 'success'}
          description={`字段 ${reviewedCount}/${reviewableIssues.length}`}
        />
        <MetricTile
          label="高风险"
          value={validation?.summary.critical ?? 0}
          tone={(validation?.summary.critical ?? 0) > 0 ? 'danger' : 'success'}
          description="金额与状态异常"
        />
        <MetricTile
          label="机构提示"
          value={institutionReviewCount}
          tone={institutionReviewCount > 0 ? 'warning' : 'success'}
          description="机构库匹配"
        />
        <MetricTile
          label="输入提示"
          value={imageIssueCount}
          tone={imageIssueCount > 0 ? 'warning' : 'default'}
          description="图片与候选诊断"
        />
      </div>
    </section>
  );
};

const ReviewStatusBanner: React.FC<{
  quality?: OcrQualityReport;
  diagnostics?: OcrDiagnosticsReport;
  reviewState?: OcrReviewState;
}> = ({ quality, diagnostics, reviewState }) => {
  const validation = diagnostics?.validation;
  if (!validation && quality) {
    return (
      <Alert
        type={getAlertType(quality)}
        showIcon
        title={getAlertMessage(quality)}
        description={quality.issues.length > 0 ? quality.issues.join('；') : quality.scope.reason}
      />
    );
  }

  if (!validation) return null;

  const reviewedIds = new Set(reviewState?.reviewedIssueIds ?? []);
  const pendingCriticalCount = validation.issues.filter((issue) => (
    issue.severity === 'critical' && !reviewedIds.has(issue.id)
  )).length;
  const pendingReviewCount = validation.issues.filter((issue) => (
    isReviewableSeverity(issue.severity) && !reviewedIds.has(issue.id)
  )).length;
  const pendingInstitutionCount = (diagnostics?.institutionCorrections ?? []).filter((item, index) => (
    needsInstitutionReview(item) && !reviewedIds.has(buildInstitutionReviewIssueId(item, index))
  )).length;

  if (pendingCriticalCount > 0) {
    return (
      <Alert
        type="error"
        showIcon
        title={`发现 ${pendingCriticalCount} 项高风险字段`}
        description="优先核对金额、账户状态、账户数量等字段，确认后再进入分析或导出。"
      />
    );
  }

  if (pendingReviewCount > 0 || pendingInstitutionCount > 0) {
    return (
      <Alert
        type="warning"
        showIcon
        title={`还有 ${pendingReviewCount + pendingInstitutionCount} 项等待确认`}
        description="复核队列中的字段、金额或机构问题会影响后续报告可信度。"
      />
    );
  }

  return (
    <Alert
      type="success"
      showIcon
      title="复核队列已清空"
      description={quality?.issues.length ? getAlertMessage(quality) : '当前字段一致性校验通过。'}
    />
  );
};

function renderDiagnostics(
  diagnostics: OcrDiagnosticsReport,
  reviewState?: OcrReviewState,
  onReviewIssues?: (issueIds: string[]) => void,
  onClearReview?: () => void,
  onOpenIssue?: (field: string) => void,
  onOpenSourcePage?: (pageIndex: number) => void,
  getFieldSourcePage?: (field: string) => number | undefined,
): React.ReactNode {
  const reviewedIds = new Set(reviewState?.reviewedIssueIds ?? []);
  const imageRows = diagnostics.images.map((item, index) => ({
    key: index,
    ...item,
    size: `${item.width}×${item.height}`,
    issueText: item.issues.join('；') || '-',
  }));

  const processingRows = (diagnostics.processing ?? []).map((item, index) => ({
    key: index,
    ...item,
    size: `${item.originalWidth}x${item.originalHeight} -> ${item.outputWidth}x${item.outputHeight}`,
    fileSize: `${formatBytes(item.originalBytes)} -> ${formatBytes(item.outputBytes)}`,
    strategyText: item.strategy === 'scan-corrected' ? '裁切矫正' : '保底增强',
    detectedText: item.detected ? '已检测' : '未检测',
    issueText: item.issues.join('；') || '-',
  }));

  const candidateRows = diagnostics.candidates.map((item, index) => ({
    key: index,
    ...item,
    issueText: item.issues.join('；') || '-',
  }));
  const institutionRows = (diagnostics.institutionCorrections ?? []).map((item, index) => ({
    key: index,
    ...item,
    reviewId: buildInstitutionReviewIssueId(item, index),
    reviewed: reviewedIds.has(buildInstitutionReviewIssueId(item, index)),
    statusLabel: getInstitutionStatusLabel(item),
    sourceText: formatInstitutionSource(item),
    candidatesText: item.candidates.join('、') || '-',
  }));
  const institutionIssueRows = institutionRows.filter((item) => needsInstitutionReview(item));
  const institutionAutoRows = institutionRows.filter((item) => !needsInstitutionReview(item));
  const institutionColumns = [
    { title: '来源位置', dataIndex: 'sourceText', key: 'sourceText', width: 260 },
    { title: '字段', dataIndex: 'field', key: 'field', width: 240 },
    { title: 'OCR 原文', dataIndex: 'original', key: 'original', width: 180 },
    { title: '输出/建议机构名', dataIndex: 'normalized', key: 'normalized', width: 220 },
    {
      title: '状态',
      key: 'status',
      width: 150,
      render: (_: unknown, row: any) => (
        <Tag color={INSTITUTION_STATUS_COLOR[row.status as InstitutionCorrectionDiagnostic['status']] ?? 'default'}>
          {row.statusLabel}
        </Tag>
      ),
    },
    {
      title: '置信度',
      key: 'confidence',
      width: 90,
      render: (_: unknown, row: any) => row.confidence > 0 ? `${Math.round(row.confidence * 100)}%` : '-',
    },
    {
      title: '是否采用',
      key: 'applied',
      width: 90,
      render: (_: unknown, row: any) => row.applied ? <Tag color="blue">已采用</Tag> : <Tag>原文保留</Tag>,
    },
    { title: '候选', dataIndex: 'candidatesText', key: 'candidatesText', width: 220 },
  ];

  const validationRows = diagnostics.validation.issues.map((item) => ({
    key: item.id,
    ...item,
    reviewed: reviewedIds.has(item.id),
  }));
  const reviewableRows = validationRows.filter((item) => isReviewableSeverity(item.severity));
  const reviewedCount = reviewableRows.filter((item) => item.reviewed).length;
  const unreviewedValidationIds = reviewableRows.filter((item) => !item.reviewed).map((item) => item.id);
  const unreviewedInstitutionIds = institutionIssueRows.filter((item) => !item.reviewed).map((item) => item.reviewId);
  const unreviewedIds = [...unreviewedValidationIds, ...unreviewedInstitutionIds];

  return (
    <div className="space-y-4">
      <Surface
        title="字段与金额复核队列"
        subtitle="金额错位、账户状态、账户数量与报告头字段"
        action={(
          <>
            {unreviewedIds.length > 0 && onReviewIssues && (
              <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => onReviewIssues(unreviewedIds)}>
                全部复核
              </Button>
            )}
            {reviewedCount > 0 && onClearReview && (
              <Button size="small" icon={<ClearOutlined />} onClick={onClearReview}>
                清除状态
              </Button>
            )}
          </>
        )}
      >
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
          <MetricTile
            label="字段校验"
            value={`${formatPercent(diagnostics.validation.score)}%`}
            tone={diagnostics.validation.score >= 0.9 ? 'success' : diagnostics.validation.score >= 0.75 ? 'warning' : 'danger'}
          />
          <MetricTile
            label="高风险"
            value={diagnostics.validation.summary.critical}
            tone={diagnostics.validation.summary.critical > 0 ? 'danger' : 'success'}
          />
          <MetricTile
            label="需复核"
            value={diagnostics.validation.summary.warning}
            tone={diagnostics.validation.summary.warning > 0 ? 'warning' : 'success'}
          />
          <MetricTile label="提示" value={diagnostics.validation.summary.info} tone="info" />
          <MetricTile label="已复核" value={`${reviewedCount}/${reviewableRows.length}`} />
        </div>

        <ReviewTaskCards
          validationRows={validationRows}
          institutionRows={institutionIssueRows}
          imageRows={imageRows}
          onOpenIssue={onOpenIssue}
          onReviewIssues={onReviewIssues}
          onOpenSourcePage={onOpenSourcePage}
          getFieldSourcePage={getFieldSourcePage}
        />

        <div className="hidden md:block">
          <Table
            dataSource={validationRows}
            size="small"
            pagination={validationRows.length > 8 ? { pageSize: 8, size: 'small' } : false}
            scroll={{ x: 1080 }}
            rowClassName={(row: any) => row.reviewed ? 'bg-emerald-50/50' : ''}
            locale={{ emptyText: '暂无字段一致性问题' }}
            columns={[
              {
                title: '级别',
                dataIndex: 'severity',
                key: 'severity',
                width: 92,
                fixed: 'left',
                render: (level: string) => {
                  const meta = getSeverityMeta(level);
                  return <Tag color={meta.color}>{meta.label}</Tag>;
                },
              },
              { title: '类别', dataIndex: 'category', key: 'category', width: 110 },
              {
                title: '字段',
                key: 'label',
                width: 180,
                render: (_: unknown, row: any) => (
                  <span className="font-mono text-xs text-slate-500">{row.label || row.field}</span>
                ),
              },
              { title: '问题', dataIndex: 'message', key: 'message', width: 280 },
              { title: '建议', dataIndex: 'suggestion', key: 'suggestion', width: 320 },
              {
                title: '状态',
                key: 'reviewed',
                width: 92,
                render: (_: unknown, row: any) => {
                  if (row.severity === 'info') return <Tag color="blue">无需确认</Tag>;
                  return row.reviewed ? <Tag color="green">已复核</Tag> : <Tag color="red">未复核</Tag>;
                },
              },
              {
                title: '操作',
                key: 'action',
                width: 112,
                fixed: 'right',
                render: (_: unknown, row: any) => (
                  <div className="flex items-center gap-1">
                    {onOpenIssue && (
                      <Tooltip title="定位并编辑字段">
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => onOpenIssue(row.field)}
                          aria-label="定位并编辑字段"
                        />
                      </Tooltip>
                    )}
                    {isReviewableSeverity(row.severity) && onReviewIssues && (
                      <Tooltip title={row.reviewed ? '已复核' : '标记已复核'}>
                        <Button
                          size="small"
                          type={row.reviewed ? 'default' : 'primary'}
                          disabled={row.reviewed}
                          icon={<CheckOutlined />}
                          onClick={() => onReviewIssues([row.id])}
                          aria-label={row.reviewed ? '已复核' : '标记已复核'}
                        />
                      </Tooltip>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Surface>

      <div className="hidden md:block">
        <Surface title="机构待复核" subtitle="仅显示疑似机构、未收录机构；已自动通过的匹配项已收起">
          <Table
            dataSource={institutionIssueRows}
            size="small"
            pagination={institutionIssueRows.length > 8 ? { pageSize: 8, size: 'small' } : false}
            scroll={{ x: 1280 }}
            rowClassName={(row: any) => row.reviewed ? 'bg-emerald-50/50' : ''}
            locale={{ emptyText: '暂无需要人工复核的机构' }}
            columns={institutionColumns}
          />
          {institutionAutoRows.length > 0 && (
            <Collapse
              className="mt-3 bg-white"
              size="small"
              ghost
              items={[{
                key: 'auto-matched-institutions',
                label: `已自动通过的机构匹配（${institutionAutoRows.length}）`,
                children: (
                  <Table
                    dataSource={institutionAutoRows}
                    size="small"
                    pagination={institutionAutoRows.length > 8 ? { pageSize: 8, size: 'small' } : false}
                    scroll={{ x: 1280 }}
                    columns={institutionColumns}
                  />
                ),
              }]}
            />
          )}
        </Surface>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Surface title="图片输入质量" subtitle="分辨率、清晰度与预处理提示">
          {processingRows.length > 0 && (
            <Table
              className="mb-3"
              dataSource={processingRows}
              size="small"
              pagination={false}
              scroll={{ x: 1060 }}
              columns={[
                { title: '导入处理', dataIndex: 'strategyText', key: 'strategyText', width: 96 },
                { title: '纸张', dataIndex: 'detectedText', key: 'detectedText', width: 82 },
                { title: '尺寸', dataIndex: 'size', key: 'size', width: 190 },
                { title: '体积', dataIndex: 'fileSize', key: 'fileSize', width: 145 },
                {
                  title: '扫描分',
                  dataIndex: 'scanScore',
                  key: 'scanScore',
                  width: 86,
                  render: (score: number) => <Tag color={score >= 78 ? 'green' : score >= 55 ? 'gold' : 'red'}>{score}</Tag>,
                },
                {
                  title: '输出分',
                  dataIndex: 'outputQualityScore',
                  key: 'outputQualityScore',
                  width: 86,
                  render: (score: number) => <Tag color={score >= 85 ? 'green' : score >= 70 ? 'gold' : 'red'}>{score}</Tag>,
                },
                { title: '清晰度', dataIndex: 'outputSharpness', key: 'outputSharpness', width: 82 },
                { title: '提示', dataIndex: 'issueText', key: 'issueText' },
              ]}
            />
          )}
          <Table
            dataSource={imageRows}
            size="small"
            pagination={imageRows.length > 6 ? { pageSize: 6, size: 'small' } : false}
            locale={{ emptyText: '非图片 OCR 或暂无图片质量诊断' }}
            columns={[
              { title: '文件', dataIndex: 'fileName', key: 'fileName', width: 180 },
              { title: '尺寸', dataIndex: 'size', key: 'size', width: 120 },
              { title: '清晰度', dataIndex: 'sharpness', key: 'sharpness', width: 90 },
              {
                title: '评分',
                dataIndex: 'score',
                key: 'score',
                width: 90,
                render: (score: number) => <Tag color={score >= 0.86 ? 'green' : score >= 0.7 ? 'gold' : 'red'}>{formatPercent(score)}%</Tag>,
              },
              { title: '提示', dataIndex: 'issueText', key: 'issueText' },
            ]}
          />
        </Surface>

        <Surface title="OCR 候选版本" subtitle="多候选识别结果与最终选中版本">
          <Table
            dataSource={candidateRows}
            size="small"
            pagination={candidateRows.length > 6 ? { pageSize: 6, size: 'small' } : false}
            locale={{ emptyText: '未触发多候选 OCR' }}
            columns={[
              { title: '文件', dataIndex: 'fileName', key: 'fileName', width: 180 },
              {
                title: '版本',
                dataIndex: 'variant',
                key: 'variant',
                width: 110,
                render: (variant: string, row: any) => <Tag color={row.selected ? 'blue' : 'default'}>{row.selected ? `${variant} 已选` : variant}</Tag>,
              },
              { title: '结构分', dataIndex: 'score', key: 'score', width: 90, render: (score: number) => `${formatPercent(score)}%` },
              { title: '表格', dataIndex: 'tables', key: 'tables', width: 70 },
              { title: '锚点', dataIndex: 'anchorsFound', key: 'anchorsFound', width: 70 },
              { title: '提示', dataIndex: 'issueText', key: 'issueText' },
            ]}
          />
        </Surface>
      </div>
    </div>
  );
}

type ValidationReviewRow = CreditReportValidationIssue & {
  key: string;
  reviewed: boolean;
};

type InstitutionReviewRow = InstitutionCorrectionDiagnostic & {
  key: number;
  reviewId: string;
  reviewed: boolean;
  statusLabel: string;
  sourceText: string;
  candidatesText: string;
};

type ImageReviewRow = OcrDiagnosticsReport['images'][number] & {
  key: number;
  size: string;
  issueText: string;
};

const ReviewTaskCards: React.FC<{
  validationRows: ValidationReviewRow[];
  institutionRows: InstitutionReviewRow[];
  imageRows: ImageReviewRow[];
  onOpenIssue?: (field: string) => void;
  onReviewIssues?: (issueIds: string[]) => void;
  onOpenSourcePage?: (pageIndex: number) => void;
  getFieldSourcePage?: (field: string) => number | undefined;
}> = ({
  validationRows,
  institutionRows,
  imageRows,
  onOpenIssue,
  onReviewIssues,
  onOpenSourcePage,
  getFieldSourcePage,
}) => {
  const fieldRows = validationRows
    .filter((row) => row.severity !== 'info' || !row.reviewed)
    .sort((a, b) => Number(a.reviewed) - Number(b.reviewed));
  const imageIssueRows = imageRows.filter((row) => row.issues.length > 0);

  if (fieldRows.length === 0 && institutionRows.length === 0 && imageIssueRows.length === 0) {
    return (
      <div className="rounded-md border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-sm text-emerald-800 md:hidden">
        暂无需要处理的移动端复核任务。
      </div>
    );
  }

  return (
    <div className="space-y-3 md:hidden">
      {fieldRows.map((row) => {
        const meta = getSeverityMeta(row.severity);
        const target = buildReviewNavigationTarget(row.field);
        const sourcePage = getFieldSourcePage?.(row.field);
        return (
          <article key={row.id} className={`review-task-card ${row.reviewed ? 'is-reviewed' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag color={meta.color}>{meta.label}</Tag>
                  {row.reviewed ? <Tag color="green">已复核</Tag> : <Tag color="red">未复核</Tag>}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-950">{row.message}</div>
                <div className="mt-1 text-xs text-slate-500">{target.label}</div>
              </div>
            </div>
            <p className="m-0 mt-2 text-xs leading-5 text-slate-600">{row.suggestion}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {onOpenIssue && (
                <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => onOpenIssue(row.field)}>
                  去复核
                </Button>
              )}
              {sourcePage !== undefined && onOpenSourcePage && (
                <Button size="small" icon={<FileSearchOutlined />} onClick={() => onOpenSourcePage(sourcePage)}>
                  看原文
                </Button>
              )}
              {isReviewableSeverity(row.severity) && onReviewIssues && (
                <Button
                  size="small"
                  icon={<CheckOutlined />}
                  disabled={row.reviewed}
                  onClick={() => onReviewIssues([row.id])}
                >
                  {row.reviewed ? '已确认' : '标记已复核'}
                </Button>
              )}
            </div>
          </article>
        );
      })}

      {institutionRows.map((row) => {
        const sourcePage = row.pageNum;
        return (
          <article key={row.reviewId} className={`review-task-card ${row.reviewed ? 'is-reviewed' : ''}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag color={INSTITUTION_STATUS_COLOR[row.status] ?? 'default'}>{row.statusLabel}</Tag>
              {row.reviewed ? <Tag color="green">已复核</Tag> : <Tag color="red">未复核</Tag>}
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {row.original || '-'} → {row.normalized || '待确认'}
            </div>
            <div className="mt-1 text-xs text-slate-500">{row.sourceText}</div>
            {row.candidatesText !== '-' && (
              <p className="m-0 mt-2 text-xs leading-5 text-slate-600">候选机构：{row.candidatesText}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {onOpenIssue && (
                <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => onOpenIssue(row.field)}>
                  去复核
                </Button>
              )}
              {sourcePage !== undefined && onOpenSourcePage && (
                <Button size="small" icon={<FileSearchOutlined />} onClick={() => onOpenSourcePage(sourcePage)}>
                  看原文
                </Button>
              )}
              {onReviewIssues && (
                <Button
                  size="small"
                  icon={<CheckOutlined />}
                  disabled={row.reviewed}
                  onClick={() => onReviewIssues([row.reviewId])}
                >
                  {row.reviewed ? '已确认' : '标记已复核'}
                </Button>
              )}
            </div>
          </article>
        );
      })}

      {imageIssueRows.map((row) => (
        <article key={`${row.fileName}-${row.key}`} className="review-task-card">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag color="gold">图片输入</Tag>
            <Tag>{formatPercent(row.score)}%</Tag>
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-950">{row.fileName}</div>
          <div className="mt-1 text-xs text-slate-500">尺寸 {row.size}，清晰度 {Math.round(row.sharpness)}</div>
          <p className="m-0 mt-2 text-xs leading-5 text-slate-600">{row.issueText}</p>
        </article>
      ))}
    </div>
  );
};

const ScoreTile: React.FC<{
  label: string;
  score: number | null;
}> = ({ label, score }) => {
  const percent = score === null ? null : formatPercent(score);
  const tone: TileTone = score === null ? 'default' : score >= 0.9 ? 'success' : score >= 0.75 ? 'warning' : 'danger';

  return (
    <div className={`min-w-0 rounded-md border px-3 py-3 ${TILE_TONE_CLASS[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-xs text-slate-500">{label}</div>
        <SafetyCertificateOutlined className="text-slate-400" />
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{percent === null ? '-' : `${percent}%`}</div>
      <Progress
        className="mt-2"
        percent={percent ?? 0}
        status={score === null ? undefined : getScoreStatus(score)}
        showInfo={false}
        size="small"
      />
    </div>
  );
};

const MetricTile: React.FC<{
  label: string;
  value: React.ReactNode;
  tone?: TileTone;
  description?: string;
}> = ({ label, value, tone = 'default', description }) => (
  <div className={`min-w-0 rounded-md border px-3 py-3 ${TILE_TONE_CLASS[tone]}`}>
    <div className="truncate text-xs text-slate-500">{label}</div>
    <div className="mt-1 truncate text-lg font-semibold text-slate-950">{value}</div>
    {description && <div className="mt-1 truncate text-xs text-slate-500">{description}</div>}
  </div>
);

const Surface: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, action, children }) => (
  <section className="rounded-lg border border-slate-200 bg-white">
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-950">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
    <div className="p-3">{children}</div>
  </section>
);

const TILE_TONE_CLASS: Record<TileTone, string> = {
  default: 'border-slate-200 bg-white',
  danger: 'border-red-100 bg-red-50/70',
  warning: 'border-amber-100 bg-amber-50/70',
  success: 'border-emerald-100 bg-emerald-50/70',
  info: 'border-blue-100 bg-blue-50/70',
};

function getOverviewStatus(
  validation: CreditReportValidationReport | undefined,
  pendingReviewCount: number,
  institutionReviewCount: number,
  pendingCriticalCount: number,
): { label: string; color: string; icon: React.ReactNode } {
  if (pendingCriticalCount > 0) {
    return { label: '高风险待核', color: 'red', icon: <ExclamationCircleOutlined /> };
  }
  if (pendingReviewCount > 0 || institutionReviewCount > 0) {
    return { label: '需要复核', color: 'gold', icon: <FileSearchOutlined /> };
  }
  if (validation) {
    return { label: '复核通过', color: 'green', icon: <CheckCircleOutlined /> };
  }
  return { label: '质量提示', color: 'blue', icon: <FileSearchOutlined /> };
}

function getSeverityMeta(level: string): { label: string; color: string } {
  if (level === 'critical') return { label: '高风险', color: 'red' };
  if (level === 'warning') return { label: '需复核', color: 'gold' };
  return { label: '提示', color: 'blue' };
}

export default OcrQualityTab;
