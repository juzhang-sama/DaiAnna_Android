import assert from 'node:assert/strict';
import {
  createEmptyCreditReport,
  type LoanAccount,
} from '../../types/credit-report';
import { buildDebtAnalysisReport } from '../debt-analysis-report';
import { buildDebtAnalysisPrompt, parseDebtAnalysisLlmJson } from '../debt-analysis-llm-service';

function makeLoan(partial: Partial<LoanAccount>): LoanAccount {
  return {
    org: '测试银行',
    accountId: partial.accountId ?? 'L1',
    openDate: '2024.01.01',
    endDate: null,
    loanAmount: partial.loanAmount ?? partial.balance ?? 0,
    currency: '人民币',
    businessType: partial.businessType ?? '个人经营性贷款',
    guaranteeType: '信用',
    termCount: null,
    termFrequency: null,
    repayMethod: null,
    jointLoanFlag: null,
    status: partial.status ?? '正常',
    fiveCategory: null,
    closeDate: null,
    balance: partial.balance ?? 0,
    remainTerms: null,
    monthlyPayment: partial.monthlyPayment ?? 0,
    paymentDueDate: null,
    actualPayment: null,
    currentOverdueCount: null,
    currentOverdueAmount: null,
    overdue31_60: null,
    overdue61_90: null,
    overdue91_180: null,
    overdue180plus: null,
    specialTransactions: [],
    repaymentRecords: [],
    dataSource: null,
    ...partial,
  };
}

const report = createEmptyCreditReport();
report.header.name = '测试客户';
report.header.reportNo = 'R1';
report.header.reportTime = '2026.04.28';
report.creditDetail.nonRevolvingLoans = [
  makeLoan({ businessType: '个人经营性贷款', balance: 675000, monthlyPayment: 2197 }),
  makeLoan({ businessType: '其他个人消费贷款', balance: 408000, monthlyPayment: 2000 }),
];

const analysis = buildDebtAnalysisReport(report);
const prompt = buildDebtAnalysisPrompt(analysis);

assert.match(prompt, /债务总额/);
assert.match(prompt, /方案测算/);
assert.match(prompt, /OCR解析/);
assert.match(prompt, /专业理财师/);
assert.match(prompt, /落地方案/);
assert.match(prompt, /优化负债结构/);
assert.match(prompt, /单版Word策略报告/);
assert.match(prompt, /语言精炼/);
assert.match(prompt, /所有数字都必须沿用输入/);
assert.match(prompt, /可分期信用卡清单/);

const parsed = parseDebtAnalysisLlmJson(`\`\`\`json
{
  "executiveSummary": "非房贷占比较高，应优先拆解经营贷和消费贷压力来源。",
  "primaryPressureSources": ["经营贷余额高", "消费贷月供高"],
  "installmentCardAnalysis": "未识别到可直接分期的信用卡已用额度，应补充账单核验。",
  "priorityActions": [
    {
      "priority": 1,
      "title": "先核查经营贷",
      "reason": "经营贷余额占比较高",
      "action": "核对合同、剩余期数和还款日",
      "evidence": ["经营贷余额675,000元"]
    }
  ],
  "planComments": [
    {
      "planKey": "mild-negotiation",
      "suitability": "适合先作为主方案评估",
      "prerequisites": ["核实机构政策"],
      "cautions": ["可能体现账户调整信息"]
    }
  ],
  "executionSteps": ["核对账户", "拆分优先级"],
  "requiredMaterials": ["贷款合同", "近6个月流水"],
  "riskWarnings": ["不得承诺减免结果"]
}
\`\`\``, analysis);

assert.equal(parsed.executiveSummary.includes('非房贷'), true);
assert.equal(parsed.primaryPressureSources.length, 2);
assert.equal(parsed.installmentCardAnalysis.includes('信用卡'), true);
assert.equal(parsed.priorityActions[0].priority, 1);
assert.equal(parsed.priorityActions[0].evidence[0], '经营贷余额675,000元');
assert.equal(parsed.planComments[0].planName, '减轻影响征信方案');
assert.equal(parsed.executionSteps[0], '核对账户');
assert.equal(parsed.requiredMaterials[1], '近6个月流水');
assert.equal(parsed.riskWarnings[0], '不得承诺减免结果');
