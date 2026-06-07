import assert from 'node:assert/strict';
import { createEmptyCreditReport, type CreditCardAccount, type LoanAccount } from '../../types/credit-report';
import { validateCreditReportData } from '../credit-report-validation';

function makeLoan(partial: Partial<LoanAccount>): LoanAccount {
  return {
    org: partial.org ?? '测试银行',
    accountId: '',
    openDate: '2024.01.01',
    endDate: null,
    loanAmount: partial.loanAmount ?? 100000,
    currency: '人民币',
    businessType: '个人消费贷款',
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
    org: partial.org ?? '测试银行',
    accountId: '',
    openDate: '2024.01.01',
    creditLimit: partial.creditLimit ?? 10000,
    sharedCreditLimit: null,
    currency: '人民币',
    businessType: '贷记卡',
    guaranteeType: '',
    status: partial.status ?? '正常',
    balance: null,
    usedAmount: partial.usedAmount ?? 0,
    unpostedLargeAmount: null,
    remainInstallments: null,
    avgUsed6m: null,
    maxUsed: null,
    billDate: null,
    monthlyPayment: null,
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
report.header.name = '张三';
report.header.reportNo = 'R1';
report.header.reportTime = '2026.06.01';
report.creditDetail.nonRevolvingLoans = [
  makeLoan({ loanAmount: 100000, balance: 150000, monthlyPayment: 0 }),
];
report.creditDetail.revolvingLoansType1 = [
  makeLoan({ org: '月供异常银行', loanAmount: 10000, balance: 787, monthlyPayment: 2713 }),
];
report.creditDetail.creditCards = [
  makeCard({ creditLimit: 10000, usedAmount: 20000 }),
];
report.accountDerived.nonRevolvingLoan = {
  orgCount: 1,
  accountCount: 2,
  totalCredit: 100000,
  balance: 150000,
  monthlyPayment: 0,
};

const validation = validateCreditReportData(report);

assert.equal(validation.requiresReview, true);
assert.equal(validation.summary.critical >= 2, true);
assert.equal(validation.issues.some((issue) => issue.message.includes('余额大于借款金额')), true);
assert.equal(validation.issues.some((issue) => issue.message.includes('本月应还异常高')), true);
assert.equal(validation.issues.some((issue) => issue.message.includes('已用额度大于授信额度')), true);
assert.equal(validation.issues.some((issue) => issue.message.includes('数量不一致')), true);
