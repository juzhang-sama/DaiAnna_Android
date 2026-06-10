import assert from 'node:assert/strict';
import { strFromU8 } from 'fflate';
import {
  createEmptyCreditReport,
  type LoanAccount,
} from '../../types/credit-report';
import { buildDebtAnalysisDocxFileName, buildDebtAnalysisDocxFiles } from '../debt-analysis-docx-export';

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
  accountCount: 3,
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

assert.match(documentXml, /测试客户-降低月供分析简版报告/);
assert.match(documentXml, /声明：本报告仅为合法降低月供规划参考/);
assert.match(documentXml, /1\. 债务清单明细/);
assert.match(documentXml, /\(1\) 债务总额：1,313,868元（抓取征信报告中所有余额总和）/);
assert.match(documentXml, /\(2\) 债务笔数：3笔/);
assert.match(documentXml, /\(3\) 贷款余额：1,313,868元/);
assert.match(documentXml, /\(4\) 信用卡已用：0元/);
assert.match(documentXml, /2\. 符合条件的信用卡分期方案/);
assert.match(documentXml, /经筛选，您当前持有的信用卡中无符合条件的可分期银行/);
assert.match(documentXml, /3\. 月供方案对比/);
assert.match(documentXml, /原月供总额为5,197元/);
assert.match(documentXml, /方案类型/);
assert.match(documentXml, /不影响征信方案/);
assert.match(documentXml, /减轻影响征信方案/);
assert.match(documentXml, /延长还款方案/);
assert.match(documentXml, /全案定制方案/);
assert.match(documentXml, /每月多出现金流（元）/);
assert.match(documentXml, /方案说明与建议/);
assert.match(documentXml, /报告生成时间：2026年04月28日/);
assert.doesNotMatch(documentXml, /详细版|简要版|AI理财师执行策略|OCR数据底稿|风险边界/);
assert.equal(buildDebtAnalysisDocxFileName(report), '测试客户-降低月供分析简版报告.docx');

const optionalFiles = buildDebtAnalysisDocxFiles(report, {
  executiveSummary: '不应作为新增章节写入导出文档',
  primaryPressureSources: ['不应作为新增章节写入'],
  installmentCardAnalysis: 'LLM建议补充信用卡账单核验，确认是否存在未体现在征信中的可分期空间。',
  priorityActions: [],
  planComments: [
    {
      planKey: 'mild-negotiation',
      planName: '减轻影响征信方案',
      suitability: 'LLM判断该方案适合优先评估，因为消费贷与经营贷月供占比较高。',
      prerequisites: ['核验机构政策', '确认客户流水'],
      cautions: ['可能体现账户调整信息'],
    },
  ],
  executionSteps: [],
  requiredMaterials: [],
  riskWarnings: [],
});
const optionalDocumentXml = strFromU8(optionalFiles['word/document.xml']);
assert.match(optionalDocumentXml, /LLM建议补充信用卡账单核验/);
assert.match(optionalDocumentXml, /优势与适用性：LLM判断该方案适合优先评估/);
assert.match(optionalDocumentXml, /执行前提：核验机构政策；确认客户流水/);
assert.match(optionalDocumentXml, /风险与劣势：可能体现账户调整信息/);
assert.doesNotMatch(optionalDocumentXml, /AI理财师执行策略|OCR数据底稿|风险边界/);
assert.doesNotMatch(optionalDocumentXml, /不应作为新增章节写入导出文档/);
