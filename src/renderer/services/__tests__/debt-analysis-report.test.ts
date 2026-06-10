import assert from 'node:assert/strict';
import {
  createEmptyCreditReport,
  type CreditCardAccount,
  type LoanAccount,
} from '../../types/credit-report';
import { buildCreditProfile } from '../credit-profile-builder';
import { buildDebtAnalysisReport } from '../debt-analysis-report';

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

function makeCard(partial: Partial<CreditCardAccount>): CreditCardAccount {
  return {
    org: partial.org ?? '广发银行',
    accountId: partial.accountId ?? 'C1',
    openDate: '2024.01.01',
    creditLimit: partial.creditLimit ?? 50000,
    sharedCreditLimit: null,
    currency: '人民币',
    businessType: '贷记卡',
    guaranteeType: '免担保',
    status: partial.status ?? '正常',
    balance: partial.balance ?? null,
    usedAmount: partial.usedAmount ?? 0,
    unpostedLargeAmount: null,
    remainInstallments: null,
    avgUsed6m: null,
    maxUsed: null,
    billDate: null,
    monthlyPayment: partial.monthlyPayment ?? 0,
    actualPayment: null,
    lastPaymentDate: null,
    currentOverdueCount: null,
    currentOverdueAmount: null,
    largeInstallmentInfo: null,
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
  makeLoan({
    accountId: 'M1',
    businessType: '个人住房贷款',
    balance: 230868,
    monthlyPayment: 1000,
  }),
  makeLoan({
    accountId: 'C1',
    businessType: '其他个人消费贷款',
    balance: 408000,
    monthlyPayment: 2000,
  }),
  makeLoan({
    accountId: 'B1',
    businessType: '个人经营性贷款',
    balance: 675000,
    monthlyPayment: 2197,
  }),
  makeLoan({
    accountId: 'X1',
    businessType: '已结清消费贷款',
    balance: 999999,
    monthlyPayment: 9999,
    status: '结清',
  }),
];

const analysis = buildDebtAnalysisReport(report);

assert.equal(analysis.customerName, '测试客户');
assert.equal(analysis.debtTotal, 1313868);
assert.equal(analysis.debtCount, 3);
assert.equal(analysis.activeLoanCount, 3);
assert.equal(analysis.originalMonthlyPayment, 5197);
assert.equal(analysis.debtBreakdown.find((item) => item.key === 'mortgage')?.balance, 230868);
assert.equal(analysis.debtBreakdown.find((item) => item.key === 'consumer')?.balance, 408000);
assert.equal(analysis.debtBreakdown.find((item) => item.key === 'business')?.balance, 675000);
assert.equal(Math.round((analysis.metrics.nonMortgageDebtShare ?? 0) * 1000) / 10, 82.4);
assert.equal(analysis.insights.some((item) => item.key === 'non-mortgage-share'), true);

const noImpactPlan = analysis.plans.find((plan) => plan.key === 'normal-optimization');
assert.equal(noImpactPlan?.targetMonthlyPayment, 4861);
assert.equal(noImpactPlan?.releasedCashFlow, 336);
assert.equal(noImpactPlan?.calculations[0].label, '非房贷还款节奏优化');

const cardReport = createEmptyCreditReport();
cardReport.creditDetail.creditCards = [
  makeCard({ org: '广发银行股份有限公司', creditLimit: 50000, usedAmount: 12000, monthlyPayment: 1200 }),
];

const cardAnalysis = buildDebtAnalysisReport(cardReport);
assert.equal(cardAnalysis.debtTotal, 12000);
assert.equal(cardAnalysis.activeCardCount, 1);
assert.equal(cardAnalysis.installmentCards[0].availableLimit, 38000);
assert.equal(cardAnalysis.installmentCards[0].usageRate, 0.24);
assert.equal(cardAnalysis.installmentCards[0].reason, '机构在可重点核查名单内');

const mixedCardReport = createEmptyCreditReport();
mixedCardReport.accountDerived.creditCard = {
  orgCount: 2,
  accountCount: 2,
  totalCredit: 150000,
  balance: 52000,
  monthlyPayment: 5200,
};
mixedCardReport.creditDetail.creditCards = [
  makeCard({
    org: '广发银行股份有限公司',
    creditLimit: 50000,
    usedAmount: 12000,
    monthlyPayment: 1200,
    status: '正常',
  }),
  makeCard({
    org: '招商银行股份有限公司',
    creditLimit: 100000,
    usedAmount: 40000,
    monthlyPayment: 4000,
    status: '其他',
  }),
];

const mixedCardAnalysis = buildDebtAnalysisReport(mixedCardReport);
assert.equal(mixedCardAnalysis.debtTotal, 12000);
assert.equal(mixedCardAnalysis.activeCardCount, 1);
assert.equal(mixedCardAnalysis.totalCardUsed, 12000);
assert.equal(mixedCardAnalysis.totalCardLimit, 50000);
assert.equal(mixedCardAnalysis.originalMonthlyPayment, 1200);
assert.equal(mixedCardAnalysis.metrics.cardUsageRate, 0.24);
assert.deepEqual(mixedCardAnalysis.installmentCards.map((card) => card.org), ['广发银行股份有限公司']);

const mixedCardProfile = buildCreditProfile(mixedCardReport);
assert.equal(mixedCardProfile.debtStatus.totalCardUsed, 12000);
assert.equal(mixedCardProfile.debtStatus.totalMonthlyPayment, 1200);
assert.equal(mixedCardProfile.debtStatus.cardUsageRate, 0.24);
assert.equal(mixedCardProfile.assetStatus.totalCardCreditLimit, 50000);
