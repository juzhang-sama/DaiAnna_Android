import assert from 'node:assert/strict';
import { strFromU8 } from 'fflate';
import {
  createEmptyCreditReport,
  type LoanAccount,
} from '../../types/credit-report';
import { buildDebtAnalysisDocxFiles } from '../debt-analysis-docx-export';

function makeLoan(partial: Partial<LoanAccount>): LoanAccount {
  return {
    org: '测试银行',
    accountId: partial.accountId ?? 'L1',
    openDate: '2024.01.01',
    endDate: null,
    loanAmount: partial.loanAmount ?? partial.balance ?? 0,
    currency: '人民币',
    businessType: partial.businessType ?? '其他个人消费贷款',
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
  makeLoan({ businessType: '个人住房贷款', balance: 230868, monthlyPayment: 1000 }),
  makeLoan({ businessType: '其他个人消费贷款', balance: 408000, monthlyPayment: 2000 }),
  makeLoan({ businessType: '个人经营性贷款', balance: 675000, monthlyPayment: 2197 }),
];
report.accountDerived.nonRevolvingLoan = {
  orgCount: 1,
  accountCount: 4,
  totalCredit: 1313868,
  balance: 1313868,
  monthlyPayment: 5197,
};

const files = buildDebtAnalysisDocxFiles(report);

assert.ok(files['[Content_Types].xml']);
assert.ok(files['_rels/.rels']);
assert.ok(files['word/document.xml']);
assert.ok(files['word/styles.xml']);

const documentXml = strFromU8(files['word/document.xml']);

assert.match(documentXml, /客户降低月供分析建议书/);
assert.match(documentXml, /结论摘要/);
assert.match(documentXml, /方向判断 \+ 保守区间/);
assert.match(documentXml, /落地方案/);
assert.match(documentXml, /执行前核验/);
assert.match(documentXml, /数据依据与风险/);
assert.match(documentXml, /减轻影响征信方案/);
assert.match(documentXml, /1,313,868 元/);
assert.match(documentXml, /5,197 元/);
assert.match(documentXml, /804-1,149 元/);
assert.match(documentXml, /未复核/);
assert.match(documentXml, /偏差超过 10%/);
assert.match(documentXml, /不得以逃废债/);
assert.doesNotMatch(documentXml, /债务类别/);

const aiFiles = buildDebtAnalysisDocxFiles(report, {
  executiveSummary: '非房贷占比较高，应优先核查经营贷和消费贷的合同与还款节奏。',
  primaryPressureSources: ['经营贷余额集中', '消费贷月供压力'],
  priorityActions: [
    {
      priority: 1,
      title: '核查经营贷',
      reason: '经营贷余额集中',
      action: '核对合同利率、剩余期数和续贷安排',
      evidence: ['经营贷余额675,000元'],
    },
  ],
  planComments: [
    {
      planKey: 'mild-negotiation',
      planName: '减轻影响征信方案',
      suitability: '适合作为主方案评估',
      prerequisites: ['核实机构政策'],
      cautions: ['可能体现账户调整信息'],
    },
  ],
  executionSteps: ['核对账户明细', '拆分处理优先级'],
  requiredMaterials: ['贷款合同', '近6个月流水'],
  riskWarnings: ['不得承诺减免结果'],
});

const aiDocumentXml = strFromU8(aiFiles['word/document.xml']);
assert.match(aiDocumentXml, /补充判断/);
assert.match(aiDocumentXml, /核查经营贷/);
assert.match(aiDocumentXml, /近 6 个月收入流水/);

const reviewFiles = buildDebtAnalysisDocxFiles(report, undefined, {
  reviewedIssueIds: ['账户数量:accountDerived.nonRevolvingLoan.accountCount:1'],
  reviewedAt: '2026-06-06T12:00:00.000Z',
}, {
  images: [],
  candidates: [],
  validation: {
    score: 1,
    requiresReview: false,
    summary: { critical: 0, warning: 0, info: 0 },
    issues: [],
  },
  institutionCorrections: [
    {
      field: 'creditDetail.nonRevolvingLoans[0].org',
      original: '测詴银行',
      normalized: '测试银行',
      confidence: 0.9,
      matched: true,
      applied: true,
      status: 'matched',
      statusLabel: '经机构库匹配',
      matchType: 'fuzzy',
      candidates: ['测试银行'],
    },
  ],
});
const reviewDocumentXml = strFromU8(reviewFiles['word/document.xml']);
assert.match(reviewDocumentXml, /数据状态/);
assert.match(reviewDocumentXml, /未复核字段/);
assert.match(reviewDocumentXml, /数据依据与风险/);
assert.doesNotMatch(reviewDocumentXml, /机构库匹配记录/);
