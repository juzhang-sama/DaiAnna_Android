/**
 * LLM 服务 — 渲染进程封装
 *
 * 通过 IPC 调用主进程 DeepSeek API，提供征信分析等高层接口
 * prompt 模板集中管理，方便后续调优
 */

import type { CreditProfile } from '../types/credit-profile';
import { getPlatformAdapters } from '../platform';
import type { AssessmentResult } from './credit-assessment';

/** LLM 结构化点评结果 */
export interface LLMComments {
  /** 综合点评（30-50字，含操作建议） */
  overall: string;
  /** 关键事实依据 */
  evidence: string[];
  /** 六维度一句话点评（15-30字） */
  dimensions: {
    basicAccess: string;
    hardInjury: string;
    debtStatus: string;
    queryFrequency: string;
    assetStatus: string;
    creditHistory: string;
  };
}

/** LLM 消息格式 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const COMMENT_SYSTEM_PROMPT = `你是一位资深助贷征信分析师。根据客户征信的事实指标和风险等级，输出结构化的一句话点评。

注意：数据中没有综合评分，只有各维度的客观指标和风险等级（正常/关注/警告/危险）。

严格按以下 JSON 格式输出，不要输出任何其他内容：
{
  "overall": "综合点评，30-50字，包含一条具体操作建议",
  "evidence": ["依据1，引用一个具体事实", "依据2，引用一个具体事实", "依据3，引用一个具体事实"],
  "dimensions": {
    "basicAccess": "基础准入点评，15-30字",
    "hardInjury": "征信硬伤点评，15-30字",
    "debtStatus": "负债状况点评，15-30字",
    "queryFrequency": "查询频次点评，15-30字",
    "assetStatus": "资产状况点评，15-30字",
    "creditHistory": "信用历史点评，15-30字"
  }
}

要求：
1. 每句话直击要害，说人话，不要罗列数字
2. 有风险的维度给出具体建议（如"建议先结清1-2笔小额贷"）
3. 正常的维度简单肯定即可（如"征信干净，无风险点"）
4. evidence 必须引用输入里的事实指标，不要编造
5. 输出 JSON，不要 markdown 代码块`;

/** 格式化单维度的指标和风险信息 */
function formatDimension(dim: { label: string; level: string; indicators: { label: string; display: string; level: string }[]; tags: string[] }): string {
  const inds = dim.indicators.map(i => `  - ${i.label}：${i.display}（${i.level}）`).join('\n');
  const tagStr = dim.tags.length > 0 ? `  标签：${dim.tags.join('、')}` : '';
  return `${dim.label}【${dim.level}】\n${inds}${tagStr ? '\n' + tagStr : ''}`;
}

/** 将 CreditProfile 和 AssessmentResult 序列化为 prompt 输入 */
function buildAnalysisPrompt(
  profile: CreditProfile,
  assessment: AssessmentResult,
): string {
  const dims = assessment.dimensions;
  const dimSections = Object.values(dims).map(formatDimension).join('\n\n');

  return `以下是客户的征信画像数据和评估结果，请进行综合分析：

【硬伤标注】${assessment.hardInjuryTags.length > 0 ? assessment.hardInjuryTags.join('、') : '无'}

【六维度风险评估】
${dimSections}

【基础信息】
- 年龄：${profile.basicAccess.age ?? '未知'}
- 婚姻：${profile.basicAccess.marriage ?? '未知'}
- 就业：${profile.basicAccess.employmentStatus ?? '未知'}

【负债概况】
- 在贷笔数：${profile.debtStatus.activeLoanCount}
- 贷款余额：${profile.debtStatus.totalLoanBalance}元
- 信用卡使用率：${profile.debtStatus.cardUsageRate !== null ? Math.round(profile.debtStatus.cardUsageRate * 100) + '%' : '无数据'}
- 近6月新增贷款：${profile.debtStatus.newLoanIn6Months}笔

【查询情况】
- 近1月：${profile.queryFrequency.queryIn1Month ?? '无数据'}次
- 近3月：${profile.queryFrequency.queryIn3Months ?? '无数据'}次
- 近6月：${profile.queryFrequency.queryIn6Months ?? '无数据'}次

【资产状况】
- 房贷：${profile.assetStatus.hasMortgage ? '有' : '无'}
- 车贷：${profile.assetStatus.hasAutoLoan ? '有' : '无'}
- 信用卡总授信：${profile.assetStatus.totalCardCreditLimit}元

【信用历史】
- 信用年限：${profile.creditHistory.creditYears ?? '未知'}年
- 已结清贷款：${profile.creditHistory.settledLoanCount}笔

请按要求输出 JSON 格式的结构化点评。`;
}

/** 从 LLM 返回文本中解析 JSON */
function parseLLMJson(text: string): LLMComments {
  // 去掉可能的 markdown 代码块包裹
  const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const dims = parsed.dimensions ?? {};
  return {
    overall: parsed.overall ?? '',
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 5) : [],
    dimensions: {
      basicAccess: dims.basicAccess ?? '',
      hardInjury: dims.hardInjury ?? '',
      debtStatus: dims.debtStatus ?? '',
      queryFrequency: dims.queryFrequency ?? '',
      assetStatus: dims.assetStatus ?? '',
      creditHistory: dims.creditHistory ?? '',
    },
  };
}

/** 调用 LLM 获取结构化一句话点评 */
export async function getLLMComments(
  profile: CreditProfile,
  assessment: AssessmentResult,
): Promise<LLMComments> {
  const messages: ChatMessage[] = [
    { role: 'system', content: COMMENT_SYSTEM_PROMPT },
    { role: 'user', content: buildAnalysisPrompt(profile, assessment) },
  ];

  const raw = await getPlatformAdapters().llmClient.chat(messages);
  return parseLLMJson(raw);
}
