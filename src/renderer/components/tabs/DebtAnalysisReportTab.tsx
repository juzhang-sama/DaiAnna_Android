import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, message, Progress, Table, Tag, Typography } from 'antd';
import { DownloadOutlined, RobotOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { CreditReport } from '../../types/credit-report';
import {
  buildDebtAnalysisReport,
  type AnalysisInsight,
  type DebtBreakdownItem,
  type InstallmentCardItem,
  type PlanCalculationLine,
  type PaymentReductionPlan,
  type PlanImpactLevel,
} from '../../services/debt-analysis-report';
import {
  buildDebtAnalysisDocxBase64,
  buildDebtAnalysisDocxFileName,
  DEBT_ANALYSIS_DOCX_MIME_TYPE,
  exportDebtAnalysisReportToDocx,
} from '../../services/debt-analysis-docx-export';
import {
  getProfessionalDebtAnalysis,
  type LlmDebtAnalysis,
  type LlmPlanComment,
  type LlmPriorityAction,
} from '../../services/debt-analysis-llm-service';
import { buildAnalysisReadiness, type AnalysisReadiness } from '../../services/analysis-readiness';
import { validateCreditReportData } from '../../services/credit-report-validation';
import { getPlatformAdapters } from '../../platform';
import type { OcrDiagnosticsReport, OcrReviewState } from '../../types/ocr-diagnostics';

interface DebtAnalysisReportTabProps {
  report: CreditReport;
  diagnostics?: OcrDiagnosticsReport;
  reviewState?: OcrReviewState;
}

const { Paragraph, Text } = Typography;

const IMPACT_COLOR: Record<PlanImpactLevel, string> = {
  低: 'green',
  中: 'gold',
  高: 'orange',
  极高: 'red',
};

const INSIGHT_COLOR: Record<AnalysisInsight['level'], string> = {
  正常: 'green',
  关注: 'gold',
  预警: 'orange',
  高风险: 'red',
};

function formatYuan(value: number): string {
  return `${Math.round(value).toLocaleString('zh-CN')} 元`;
}

function formatRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 1000) / 10}%`;
}

function formatReviewTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function renderTextList(items: string[]): React.ReactNode {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item} className="text-xs leading-5">{item}</div>
      ))}
    </div>
  );
}

function renderCalculationList(items: PlanCalculationLine[]): React.ReactNode {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={`${item.label}-${item.amount}`} className="text-xs leading-5">
          <Text strong>{item.label}</Text>：{formatYuan(item.amount)}
          <div className="text-gray-500">{item.explanation}</div>
        </div>
      ))}
    </div>
  );
}

const DebtAnalysisReportTab: React.FC<DebtAnalysisReportTabProps> = ({ report, diagnostics, reviewState }) => {
  const platform = useMemo(() => getPlatformAdapters(), []);
  const analysis = useMemo(() => buildDebtAnalysisReport(report), [report]);
  const validation = useMemo(() => validateCreditReportData(report), [report]);
  const readiness = useMemo(() => buildAnalysisReadiness(validation, reviewState), [reviewState, validation]);
  const canExport = Boolean(analysis.reportNo || analysis.debtTotal > 0 || analysis.originalMonthlyPayment > 0);
  const canRunAnalysisActions = canExport && !readiness.blocked;
  const [aiAnalysis, setAiAnalysis] = useState<LlmDebtAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    setAiAnalysis(null);
    setAiError('');
  }, [report, readiness.blocked]);

  const handleExportDocx = useCallback(async () => {
    if (!canExport) {
      message.warning('暂无可导出的分析数据');
      return;
    }
    if (readiness.blocked) {
      message.warning(readiness.actionHint);
      return;
    }
    if (exportingDocx) return;

    setExportingDocx(true);
    try {
      const fileName = buildDebtAnalysisDocxFileName(report);
      if (platform.kind === 'capacitor' && platform.share?.shareFileData) {
        const base64 = buildDebtAnalysisDocxBase64(
          report,
          undefined,
          reviewState,
          diagnostics,
        );
        await platform.share.shareFileData({
          fileName,
          mimeType: DEBT_ANALYSIS_DOCX_MIME_TYPE,
          base64,
        });
        message.success('已打开系统分享');
      } else {
        exportDebtAnalysisReportToDocx(report, fileName, undefined, reviewState, diagnostics);
        message.success('分析报告已导出');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Word 方案导出失败';
      message.error(msg);
    } finally {
      setExportingDocx(false);
    }
  }, [canExport, diagnostics, exportingDocx, platform, readiness, report, reviewState]);

  const handleAiAnalysis = useCallback(async () => {
    if (!canExport) {
      message.warning('暂无可分析的数据');
      return;
    }
    if (readiness.blocked) {
      message.warning(readiness.actionHint);
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const result = await getProfessionalDebtAnalysis(analysis);
      setAiAnalysis(result);
      message.success('AI 落地策略已生成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 分析失败';
      setAiError(msg);
      message.error('AI 分析失败，请检查 DeepSeek 配置或稍后重试');
    } finally {
      setAiLoading(false);
    }
  }, [analysis, canExport, readiness]);

  const debtColumns: ColumnsType<DebtBreakdownItem> = [
    { title: '债务类别', dataIndex: 'label', key: 'label', width: 140 },
    { title: '账户数', dataIndex: 'count', key: 'count', width: 90, align: 'right' },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
      width: 140,
      align: 'right',
      render: (value: number) => formatYuan(value),
    },
    {
      title: '余额占比',
      key: 'share',
      width: 100,
      align: 'right',
      render: (_, record) => formatRatio(record.balanceShare),
    },
    {
      title: '月供占比',
      key: 'paymentShare',
      width: 100,
      align: 'right',
      render: (_, record) => formatRatio(record.paymentShare),
    },
    {
      title: '本月应还',
      dataIndex: 'monthlyPayment',
      key: 'monthlyPayment',
      width: 140,
      align: 'right',
      render: (value: number) => formatYuan(value),
    },
    {
      title: '月供密度',
      dataIndex: 'paymentRate',
      key: 'paymentRate',
      width: 100,
      align: 'right',
      render: (value: number | null) => formatRatio(value),
    },
    {
      title: '余额结构',
      key: 'balanceShareBar',
      width: 170,
      render: (_, record) => (
        <div className="flex items-center gap-2">
          <Progress
            percent={Math.round((record.balanceShare ?? 0) * 100)}
            showInfo={false}
            size="small"
            strokeColor="#2563eb"
          />
          <span className="w-12 text-right text-xs text-slate-500">{formatRatio(record.balanceShare)}</span>
        </div>
      ),
    },
  ];

  const cardColumns: ColumnsType<InstallmentCardItem> = [
    { title: '发卡机构', dataIndex: 'org', key: 'org', width: 200 },
    {
      title: '授信额度',
      dataIndex: 'creditLimit',
      key: 'creditLimit',
      width: 120,
      align: 'right',
      render: (value: number) => formatYuan(value),
    },
    {
      title: '已用额度',
      dataIndex: 'usedAmount',
      key: 'usedAmount',
      width: 120,
      align: 'right',
      render: (value: number) => formatYuan(value),
    },
    {
      title: '可用额度',
      dataIndex: 'availableLimit',
      key: 'availableLimit',
      width: 120,
      align: 'right',
      render: (value: number) => formatYuan(value),
    },
    {
      title: '使用率',
      dataIndex: 'usageRate',
      key: 'usageRate',
      width: 90,
      align: 'right',
      render: (value: number | null) => formatRatio(value),
    },
    {
      title: '本月应还',
      dataIndex: 'monthlyPayment',
      key: 'monthlyPayment',
      width: 120,
      align: 'right',
      render: (value: number) => formatYuan(value),
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
    { title: '核查提示', dataIndex: 'reason', key: 'reason', width: 220 },
  ];

  const planColumns: ColumnsType<PaymentReductionPlan> = [
    { title: '方案', dataIndex: 'name', key: 'name', width: 150, fixed: 'left' },
    {
      title: '征信影响',
      dataIndex: 'impactLevel',
      key: 'impactLevel',
      width: 90,
      render: (level: PlanImpactLevel) => <Tag color={IMPACT_COLOR[level]}>{level}</Tag>,
    },
    {
      title: '原月供',
      dataIndex: 'originalMonthlyPayment',
      key: 'originalMonthlyPayment',
      width: 120,
      align: 'right',
      render: (value: number) => formatYuan(value),
    },
    {
      title: '预计月供',
      dataIndex: 'targetMonthlyPayment',
      key: 'targetMonthlyPayment',
      width: 120,
      align: 'right',
      render: (value: number) => formatYuan(value),
    },
    {
      title: '释放现金流',
      dataIndex: 'releasedCashFlow',
      key: 'releasedCashFlow',
      width: 130,
      align: 'right',
      render: (value: number) => <Text strong>{formatYuan(value)}</Text>,
    },
    {
      title: '测算明细',
      dataIndex: 'calculations',
      key: 'calculations',
      width: 320,
      render: (items: PlanCalculationLine[]) => renderCalculationList(items),
    },
    { title: '测算依据', dataIndex: 'basis', key: 'basis', width: 260 },
    {
      title: '优势',
      dataIndex: 'advantages',
      key: 'advantages',
      width: 220,
      render: (items: string[]) => renderTextList(items),
    },
    {
      title: '风险',
      dataIndex: 'risks',
      key: 'risks',
      width: 260,
      render: (items: string[]) => renderTextList(items),
    },
    { title: '合规提示', dataIndex: 'complianceNote', key: 'complianceNote', width: 280 },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-950">客户债务总览</div>
            <div className="mt-1 text-sm text-slate-500">
              所有测算基于征信结构化结果，关键金额需经过复核后再进入报告。
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              icon={<RobotOutlined />}
              onClick={handleAiAnalysis}
              disabled={!canRunAnalysisActions || exportingDocx}
              loading={aiLoading}
            >
              AI 落地策略
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleExportDocx}
              disabled={!canRunAnalysisActions || exportingDocx}
              loading={exportingDocx}
            >
              导出报告
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="债务总额" value={formatYuan(analysis.debtTotal)} tone="blue" />
          <Metric label="当前月供" value={formatYuan(analysis.originalMonthlyPayment)} tone="green" />
          <Metric label="本月应还" value={formatYuan(analysis.originalMonthlyPayment)} tone="amber" />
          <Metric label="信用卡使用率" value={formatRatio(analysis.metrics.cardUsageRate)} tone="purple" />
          <Metric label="当前逾期账户" value={`${analysis.metrics.overdueAccountCount} 个`} tone="red" />
          <Metric label="债务账户" value={`${analysis.debtCount} 笔`} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile label="客户姓名" value={analysis.customerName || '-'} />
          <InfoTile label="报告时间" value={analysis.reportTime || '-'} />
          <InfoTile label="报告编号" value={analysis.reportNo || '-'} />
          <InfoTile label="信用卡总授信" value={formatYuan(analysis.totalCardLimit)} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-4">
          <Panel title="债务结构">
            <Table
              rowKey="key"
              dataSource={analysis.debtBreakdown}
              columns={debtColumns}
              size="small"
              pagination={false}
              scroll={{ x: 940 }}
              locale={{ emptyText: '暂未识别到有效债务明细' }}
            />
          </Panel>

          <Panel title="可分期信用卡清单">
            <Table
              rowKey="key"
              dataSource={analysis.installmentCards}
              columns={cardColumns}
              size="small"
              pagination={false}
              scroll={{ x: 1100 }}
              locale={{ emptyText: '暂未识别到有已用额度的信用卡账户' }}
            />
          </Panel>

          <Panel title="降低月供方案对比">
            <Table
              rowKey="key"
              dataSource={analysis.plans}
              columns={planColumns}
              size="small"
              pagination={false}
              scroll={{ x: 1600 }}
            />
          </Panel>
        </main>

        <aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
          <Panel title="结构洞察">
            <div className="space-y-3">
              {analysis.insights.map((insight) => (
                <InsightCard key={insight.key} insight={insight} />
              ))}
            </div>
          </Panel>

          <Panel title="OCR 复核状态">
            {canExport ? (
              <ReadinessSummary readiness={readiness} reviewState={reviewState} />
            ) : (
              <div className="text-sm text-slate-500">暂无可用于分析的征信数据。</div>
            )}
          </Panel>

          <Panel title="AI 建议状态">
            {aiError && (
              <Alert type="error" showIcon title="AI 分析失败" description={aiError} className="mb-3" />
            )}
            {aiAnalysis ? (
              <AiAnalysisContent analysis={aiAnalysis} />
            ) : (
              <div className="space-y-2 text-sm text-slate-500">
                <div>AI 建议尚未生成。</div>
                <Button
                  block
                  icon={<RobotOutlined />}
                  onClick={handleAiAnalysis}
                  disabled={!canRunAnalysisActions}
                  loading={aiLoading}
                >
                  生成落地策略
                </Button>
              </div>
            )}
          </Panel>

          <Panel title="下一步建议">
            <div className="space-y-2">
              {analysis.summary.slice(0, 2).map((line) => (
                <div key={line} className="text-sm leading-6 text-slate-700">{line}</div>
              ))}
              {analysis.riskNotes.slice(0, 2).map((line) => (
                <div key={line} className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">{line}</div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
};

const Panel: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <section className="rounded-lg border border-slate-200 bg-white">
    <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-950">
      {title}
    </div>
    <div className="p-3">{children}</div>
  </section>
);

const InsightCard: React.FC<{ insight: AnalysisInsight }> = ({ insight }) => (
  <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
    <div className="flex items-start justify-between gap-2">
      <div className="text-sm font-medium text-slate-900">{insight.title}</div>
      <Tag color={INSIGHT_COLOR[insight.level]}>{insight.level}</Tag>
    </div>
    <div className="mt-2 text-xs leading-5 text-slate-600">{insight.description}</div>
    <div className="mt-2 space-y-1 text-xs text-slate-500">
      {insight.evidence.map((item) => <div key={item}>{item}</div>)}
    </div>
    <div className="mt-2 text-xs leading-5 text-blue-600">{insight.suggestion}</div>
  </div>
);

const ReadinessSummary: React.FC<{
  readiness: AnalysisReadiness;
  reviewState?: OcrReviewState;
}> = ({ readiness, reviewState }) => {
  if (readiness.blocked) {
    return (
      <div className="space-y-3">
        <Alert
          type={readiness.alertType}
          showIcon
          title={readiness.reason}
          description={readiness.actionHint}
        />
        <div className="space-y-2">
          {readiness.displayIssues.map((issue) => (
            <div key={issue.id} className="rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
              <span className="font-medium">{issue.category}</span>：{issue.message}
            </div>
          ))}
          {readiness.hiddenIssueCount > 0 && (
            <div className="text-xs text-slate-500">另有 {readiness.hiddenIssueCount} 项需复核。</div>
          )}
        </div>
      </div>
    );
  }

  if (readiness.reviewedIssueCount > 0) {
    return (
      <Alert
        type="success"
        showIcon
        title="复核已确认"
        description={`已人工复核 ${readiness.reviewedIssueCount} 项${
          reviewState?.reviewedAt ? `，${formatReviewTime(reviewState.reviewedAt)}` : ''
        }。`}
      />
    );
  }

  return <Alert type="success" showIcon title="当前未阻断分析" description="可继续生成 AI 分析或导出报告。" />;
};

const AnalysisReadinessAlert: React.FC<{ readiness: AnalysisReadiness }> = ({ readiness }) => {
  if (!readiness.blocked) return null;

  return (
    <Alert
      type={readiness.alertType}
      showIcon
      title={`OCR 关键字段需复核：${readiness.reason}`}
      description={
        <div className="space-y-2">
          <div>
            已暂缓 AI 落地策略和 Word 导出。请先在“解析质量”页或明细页核对金额、账户状态和账户数量，避免错误数据进入后续方案。
          </div>
          <div className="space-y-1">
            {readiness.displayIssues.map((issue) => (
              <div key={issue.id} className="text-xs leading-5">
                <Text strong>{issue.category}</Text>：{issue.message}
                <span className="text-gray-500">｜{issue.suggestion}</span>
              </div>
            ))}
            {readiness.hiddenIssueCount > 0 && (
              <div className="text-xs text-gray-500">另有 {readiness.hiddenIssueCount} 项需复核。</div>
            )}
          </div>
        </div>
      }
    />
  );
};

const AnalysisReviewConfirmedAlert: React.FC<{
  readiness: AnalysisReadiness;
  reviewState?: OcrReviewState;
}> = ({ readiness, reviewState }) => {
  if (readiness.blocked || readiness.reviewedIssueCount === 0) return null;

  return (
    <Alert
      type="success"
      showIcon
      title="OCR 复核已确认，已恢复 AI 分析和 Word 导出"
      description={`已人工复核 ${readiness.reviewedIssueCount} 项字段问题${
        reviewState?.reviewedAt ? `，确认时间：${formatReviewTime(reviewState.reviewedAt)}` : ''
      }。后续如继续修改字段，系统会重新要求复核。`}
    />
  );
};

const AiAnalysisContent: React.FC<{ analysis: LlmDebtAnalysis }> = ({ analysis }) => (
  <div className="space-y-4">
    <div>
      <Text strong>综合判断</Text>
      <Paragraph className="mb-0 mt-1">{analysis.executiveSummary || '暂无综合判断'}</Paragraph>
    </div>

    {analysis.primaryPressureSources.length > 0 && (
      <div>
        <Text strong>主要压力来源</Text>
        <div className="flex flex-wrap gap-1 mt-2">
          {analysis.primaryPressureSources.map((item) => (
            <Tag key={item} color="blue">{item}</Tag>
          ))}
        </div>
      </div>
    )}

    {analysis.priorityActions.length > 0 && (
      <div>
        <Text strong>优先处理动作</Text>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-2">
          {analysis.priorityActions.map((item) => (
            <PriorityActionCard key={`${item.priority}-${item.title}`} item={item} />
          ))}
        </div>
      </div>
    )}

    {analysis.planComments.length > 0 && (
      <div>
        <Text strong>方案适用性点评</Text>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-2">
          {analysis.planComments.map((item) => (
            <PlanCommentCard key={`${item.planKey}-${item.planName}`} item={item} />
          ))}
        </div>
      </div>
    )}

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <CompactList title="执行步骤" items={analysis.executionSteps} />
      <CompactList title="补充核验资料" items={analysis.requiredMaterials} />
      <CompactList title="风险提示" items={analysis.riskWarnings} />
    </div>
  </div>
);

const PriorityActionCard: React.FC<{ item: LlmPriorityAction }> = ({ item }) => (
  <div className="border border-gray-100 rounded px-3 py-2 bg-gray-50">
    <div className="flex items-center gap-2 mb-1">
      <Tag color="processing">#{item.priority}</Tag>
      <Text strong>{item.title}</Text>
    </div>
    <Paragraph className="mb-1 text-sm">{item.reason}</Paragraph>
    <div className="text-xs text-blue-600 mb-1">{item.action}</div>
    {item.evidence.length > 0 && (
      <div className="text-xs text-gray-500">
        {item.evidence.map((evidence) => <div key={evidence}>{evidence}</div>)}
      </div>
    )}
  </div>
);

const PlanCommentCard: React.FC<{ item: LlmPlanComment }> = ({ item }) => (
  <div className="border border-gray-100 rounded px-3 py-2 bg-gray-50">
    <Text strong>{item.planName}</Text>
    <Paragraph className="mb-2 text-sm">{item.suitability}</Paragraph>
    <div className="grid grid-cols-1 gap-2">
      <CompactList title="执行前提" items={item.prerequisites} />
      <CompactList title="注意事项" items={item.cautions} />
    </div>
  </div>
);

const CompactList: React.FC<{ title: string; items: string[] }> = ({ title, items }) => (
  <div>
    <div className="text-xs font-medium text-gray-500 mb-1">{title}</div>
    {items.length > 0 ? (
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item} className="text-xs leading-5">{item}</div>
        ))}
      </div>
    ) : (
      <div className="text-xs text-gray-400">暂无</div>
    )}
  </div>
);

const METRIC_TONE: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  purple: 'bg-violet-50 text-violet-700 ring-violet-100',
  red: 'bg-red-50 text-red-700 ring-red-100',
  slate: 'bg-slate-50 text-slate-700 ring-slate-100',
};

const Metric: React.FC<{ label: string; value: string; tone?: keyof typeof METRIC_TONE }> = ({
  label,
  value,
  tone = 'slate',
}) => (
  <div className={`rounded-lg px-3 py-3 ring-1 ${METRIC_TONE[tone]}`}>
    <div className="text-xs opacity-75">{label}</div>
    <div className="mt-1 text-lg font-semibold">{value}</div>
  </div>
);

const InfoTile: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
    <div className="text-xs text-slate-500">{label}</div>
    <div className="mt-1 min-w-0 break-words text-sm font-medium leading-5 text-slate-900">{value}</div>
  </div>
);

export default DebtAnalysisReportTab;
