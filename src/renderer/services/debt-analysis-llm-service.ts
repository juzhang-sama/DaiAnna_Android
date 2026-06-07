import type { DebtAnalysisReport } from './debt-analysis-report';
import { getPlatformAdapters } from '../platform';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmPriorityAction {
  priority: number;
  title: string;
  reason: string;
  action: string;
  evidence: string[];
}

export interface LlmPlanComment {
  planKey: string;
  planName: string;
  suitability: string;
  prerequisites: string[];
  cautions: string[];
}

export interface LlmDebtAnalysis {
  executiveSummary: string;
  primaryPressureSources: string[];
  priorityActions: LlmPriorityAction[];
  planComments: LlmPlanComment[];
  executionSteps: string[];
  requiredMaterials: string[];
  riskWarnings: string[];
}

const DEBT_ANALYSIS_SYSTEM_PROMPT = `你是一位资深征信债务结构分析顾问，专门根据央行个人征信报告的结构化结果做现金流压力分析。

你必须遵守：
1. 只基于输入事实分析，不得编造客户收入、流水、利率、资产、合同条款或机构政策。
2. 金额、月供、账户数、占比、方案测算数字必须完全沿用输入，不得自行重新计算或改写。
3. 你的职责是解释压力来源、排序处理优先级、说明方案适用条件、列出执行步骤和复核资料。
4. 不得诱导逃废债，不得承诺降息、减免、授信或征信结果。
5. 如果某项判断需要补充资料，明确写“需补充核验”。
6. 输出应服务于“降低当前月供”的建议书，不要大段复述数据，不要写成数据统计表说明。

严格按以下 JSON 输出，不要输出 Markdown，不要输出解释：
{
  "executiveSummary": "80-140字综合判断，必须引用关键压力来源，不要泛泛而谈",
  "primaryPressureSources": ["压力来源1", "压力来源2", "压力来源3"],
  "priorityActions": [
    {
      "priority": 1,
      "title": "优先动作标题",
      "reason": "为什么先做这件事",
      "action": "具体怎么做",
      "evidence": ["必须引用输入事实"]
    }
  ],
  "planComments": [
    {
      "planKey": "方案key",
      "planName": "方案名称",
      "suitability": "适用性判断",
      "prerequisites": ["执行前提1", "执行前提2"],
      "cautions": ["风险提醒1", "风险提醒2"]
    }
  ],
  "executionSteps": ["第一步", "第二步", "第三步"],
  "requiredMaterials": ["需要补充核验的资料1", "资料2"],
  "riskWarnings": ["合规或征信风险提示1", "风险提示2"]
}`;

export async function getProfessionalDebtAnalysis(analysis: DebtAnalysisReport): Promise<LlmDebtAnalysis> {
  const messages: ChatMessage[] = [
    { role: 'system', content: DEBT_ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: buildDebtAnalysisPrompt(analysis) },
  ];

  const raw = await getPlatformAdapters().llmClient.chat(messages);
  return parseDebtAnalysisLlmJson(raw, analysis);
}

export function buildDebtAnalysisPrompt(analysis: DebtAnalysisReport): string {
  return `请基于以下“已由规则引擎计算完成”的事实，生成专业分析建议。所有数字都必须沿用输入，不得重新计算。

【客户与报告】
- 客户姓名：${analysis.customerName || '未识别'}
- 报告编号：${analysis.reportNo || '未识别'}
- 报告时间：${analysis.reportTime || '未识别'}

【总览指标】
- 债务总额：${formatYuan(analysis.debtTotal)}
- 债务账户：${analysis.debtCount}笔
- 有效贷款账户：${analysis.activeLoanCount}笔
- 有效信用卡账户：${analysis.activeCardCount}笔
- 贷款余额：${formatYuan(analysis.totalLoanBalance)}
- 信用卡已用额度：${formatYuan(analysis.totalCardUsed)}
- 信用卡总授信：${formatYuan(analysis.totalCardLimit)}
- 当前月供：${formatYuan(analysis.originalMonthlyPayment)}
- 非房贷占比：${formatRatio(analysis.metrics.nonMortgageDebtShare)}
- 经营贷占比：${formatRatio(analysis.metrics.businessDebtShare)}
- 信用卡使用率：${formatRatio(analysis.metrics.cardUsageRate)}
- 月供密度：${formatRatio(analysis.metrics.monthlyPaymentRate)}
- 当前逾期账户数：${analysis.metrics.overdueAccountCount}个

【债务结构】
${analysis.debtBreakdown.map((item) => [
    `- ${item.label}`,
    `账户数${item.count}笔`,
    `余额${formatYuan(item.balance)}`,
    `余额占比${formatRatio(item.balanceShare)}`,
    `月供${formatYuan(item.monthlyPayment)}`,
    `月供占比${formatRatio(item.paymentShare)}`,
    `月供密度${formatRatio(item.paymentRate)}`,
  ].join('，')).join('\n')}

【规则引擎结构洞察】
${analysis.insights.map((item) => [
    `- ${item.title}（${item.level}）`,
    `说明：${item.description}`,
    `依据：${item.evidence.join('；')}`,
    `建议：${item.suggestion}`,
  ].join('\n  ')).join('\n')}

【可分期信用卡清单】
${analysis.installmentCards.length > 0
    ? analysis.installmentCards.map((card) => [
      `- ${card.org}`,
      `授信${formatYuan(card.creditLimit)}`,
      `已用${formatYuan(card.usedAmount)}`,
      `使用率${formatRatio(card.usageRate)}`,
      `月供${formatYuan(card.monthlyPayment)}`,
      `提示：${card.reason}`,
    ].join('，')).join('\n')
    : '- 未识别到有已用额度的信用卡账户'}

【方案测算】
${analysis.plans.map((plan) => [
    `- key=${plan.key}`,
    `方案=${plan.name}`,
    `征信影响=${plan.impactLevel}`,
    `原月供=${formatYuan(plan.originalMonthlyPayment)}`,
    `预计月供=${formatYuan(plan.targetMonthlyPayment)}`,
    `释放现金流=${formatYuan(plan.releasedCashFlow)}`,
    `测算依据=${plan.basis}`,
    `测算明细=${plan.calculations.map((item) => `${item.label}${formatYuan(item.amount)}：${item.explanation}`).join('；')}`,
    `优势=${plan.advantages.join('；')}`,
    `风险=${plan.risks.join('；')}`,
    `合规提示=${plan.complianceNote}`,
  ].join('\n  ')).join('\n')}

【已有风险提示】
${analysis.riskNotes.map((item) => `- ${item}`).join('\n')}
`;
}

export function parseDebtAnalysisLlmJson(text: string, analysis: DebtAnalysisReport): LlmDebtAnalysis {
  const parsed = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;
  const fallbackPlanNames = new Map(analysis.plans.map((plan) => [plan.key, plan.name]));

  return {
    executiveSummary: pickString(parsed.executiveSummary),
    primaryPressureSources: pickStringArray(parsed.primaryPressureSources, 5),
    priorityActions: pickArray(parsed.priorityActions, 6).map((item, index) => {
      const obj = asObject(item);
      return {
        priority: pickNumber(obj.priority, index + 1),
        title: pickString(obj.title),
        reason: pickString(obj.reason),
        action: pickString(obj.action),
        evidence: pickStringArray(obj.evidence, 5),
      };
    }).filter((item) => item.title || item.reason || item.action),
    planComments: pickArray(parsed.planComments, 8).map((item) => {
      const obj = asObject(item);
      const planKey = pickString(obj.planKey);
      return {
        planKey,
        planName: pickString(obj.planName) || fallbackPlanNames.get(planKey) || planKey,
        suitability: pickString(obj.suitability),
        prerequisites: pickStringArray(obj.prerequisites, 5),
        cautions: pickStringArray(obj.cautions, 5),
      };
    }).filter((item) => item.planKey || item.planName || item.suitability),
    executionSteps: pickStringArray(parsed.executionSteps, 8),
    requiredMaterials: pickStringArray(parsed.requiredMaterials, 8),
    riskWarnings: pickStringArray(parsed.riskWarnings, 8),
  };
}

function extractJsonObject(text: string): string {
  const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickArray(value: unknown, limit: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function pickStringArray(value: unknown, limit: number): string[] {
  return pickArray(value, limit).map(pickString).filter(Boolean);
}

function formatYuan(value: number): string {
  return `${Math.round(value).toLocaleString('zh-CN')}元`;
}

function formatRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '无数据';
  return `${Math.round(value * 1000) / 10}%`;
}
