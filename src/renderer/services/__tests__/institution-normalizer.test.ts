import assert from 'node:assert/strict';
import { createEmptyCreditReport, type CreditCardAccount, type RevolvingLoanAccount } from '../../types/credit-report';
import { normalizeCreditReportInstitutions, normalizeInstitutionName } from '../institution-normalizer';

function makeRevolvingLoan(partial: Partial<RevolvingLoanAccount>): RevolvingLoanAccount {
  return {
    org: partial.org ?? '招商银行',
    accountId: '',
    openDate: '2024.01.01',
    endDate: null,
    creditLimit: partial.creditLimit ?? 10000,
    currency: '人民币',
    businessType: '循环贷',
    guaranteeType: '信用',
    termCount: null,
    termFrequency: null,
    repayMethod: null,
    jointLoanFlag: null,
    status: '正常',
    fiveCategory: null,
    closeDate: null,
    balance: partial.balance ?? 1000,
    remainTerms: null,
    monthlyPayment: partial.monthlyPayment ?? 100,
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
    accountId: '',
    openDate: '2024.01.01',
    creditLimit: partial.creditLimit ?? 10000,
    sharedCreditLimit: null,
    currency: '人民币',
    businessType: '贷记卡',
    guaranteeType: '',
    status: '正常',
    balance: null,
    usedAmount: partial.usedAmount ?? 1000,
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

const alias = normalizeInstitutionName('招行');
assert.equal(alias.matched, true);
assert.equal(alias.normalized, '招商银行股份有限公司');
assert.equal(alias.status, 'matched');
assert.equal(alias.applied, true);

const fuzzy = normalizeInstitutionName('广發银行股份有限公司');
assert.equal(fuzzy.matched, true);
assert.equal(fuzzy.normalized, '广发银行股份有限公司');
assert.equal(fuzzy.statusLabel, '机构库精确匹配');

const consumerFinance = normalizeInstitutionName('河南中原消费金融股份有限公司');
assert.equal(consumerFinance.matched, true);
assert.equal(consumerFinance.normalized, '河南中原消费金融股份有限公司');

const guarantee = normalizeInstitutionName('深圳市乐信融资担保有限公司');
assert.equal(guarantee.matched, true);
assert.equal(guarantee.normalized, '深圳市乐信融资担保有限公司');

const pingAnGuarantee = normalizeInstitutionName('平安融易（江苏）融资担保有限公司');
assert.equal(pingAnGuarantee.matched, true);
assert.equal(pingAnGuarantee.normalized, '平安融易（江苏）融资担保有限公司');

const leasing = normalizeInstitutionName('狮桥融资租赁（中国）有限公司');
assert.equal(leasing.matched, true);
assert.equal(leasing.normalized, '狮桥融资租赁（中国）有限公司');

const htscLeasing = normalizeInstitutionName('汇通信诚租赁有限公司');
assert.equal(htscLeasing.matched, true);
assert.equal(htscLeasing.normalized, '汇通信诚租赁有限公司');

const zhongguancunBank = normalizeInstitutionName('中关村银行');
assert.equal(zhongguancunBank.matched, true);
assert.equal(zhongguancunBank.normalized, '北京中关村银行股份有限公司');

const zrxGuarantee = normalizeInstitutionName('中融信融资担保（大连）股份有限公司');
assert.equal(zrxGuarantee.matched, true);
assert.equal(zrxGuarantee.normalized, '中融信融资担保（大连）股份有限公司');

const webankFullName = normalizeInstitutionName('深圳前海微众银行股份有限公司');
assert.equal(webankFullName.matched, true);
assert.equal(webankFullName.normalized, '微众银行股份有限公司');

const webankTruncated = normalizeInstitutionName('深圳前海微众银行股份有限公');
assert.equal(webankTruncated.matched, true);
assert.equal(webankTruncated.normalized, '微众银行股份有限公司');

const ccbBranch = normalizeInstitutionName('中国建设银行股份有限公司天津大港支行');
assert.equal(ccbBranch.matched, true);
assert.equal(ccbBranch.normalized, '中国建设银行股份有限公司');

const cebCardCenter = normalizeInstitutionName('中国光大银行股份有限公司信用卡中');
assert.equal(cebCardCenter.matched, true);
assert.equal(cebCardCenter.normalized, '中国光大银行股份有限公司');

const cmbCardCenter = normalizeInstitutionName('招商银行股份有限公司信用卡中心天津分中心');
assert.equal(cmbCardCenter.matched, true);
assert.equal(cmbCardCenter.normalized, '招商银行股份有限公司');

const icbcCardCenter = normalizeInstitutionName('中国工商银行股份有限公司银行卡业务部（牡丹卡中心）');
assert.equal(icbcCardCenter.matched, true);
assert.equal(icbcCardCenter.normalized, '中国工商银行股份有限公司');

const shengjingTruncatedBranch = normalizeInstitutionName('盛京银行股份有限公司沈阳分');
assert.equal(shengjingTruncatedBranch.matched, true);
assert.equal(shengjingTruncatedBranch.normalized, '盛京银行股份有限公司');

const shengjingBrokenSuffix = normalizeInstitutionName('盛京银行股 有限 公司沈');
assert.equal(shengjingBrokenSuffix.matched, true);
assert.equal(shengjingBrokenSuffix.normalized, '盛京银行股份有限公司');

const weihaiSuffixTypo = normalizeInstitutionName('威海银行股份有限公公司');
assert.equal(weihaiSuffixTypo.matched, true);
assert.equal(weihaiSuffixTypo.normalized, '威海银行股份有限公司');

const ocrTypo = normalizeInstitutionName('兴业消费全融股份公司');
assert.equal(ocrTypo.matched, true);
assert.equal(ocrTypo.normalized, '兴业消费金融股份公司');

const amountFragment = normalizeInstitutionName('10,000');
assert.equal(amountFragment.matched, false);
assert.equal(amountFragment.status, 'review');

const fragment = normalizeInstitutionName('信用卡中心');
assert.equal(fragment.matched, false);
assert.equal(fragment.status, 'review');
assert.equal(fragment.statusLabel, '疑似机构残片，请复核');

const unknown = normalizeInstitutionName('某某测试机构');
assert.equal(unknown.matched, false);
assert.equal(unknown.status, 'unlisted');
assert.equal(unknown.statusLabel, '该机构未被收录');

const report = createEmptyCreditReport();
report.creditDetail.revolvingLoansType2 = [
  makeRevolvingLoan({ org: '重庆美团三快小额贷X44031234款有限公司' }),
];
report.creditDetail.creditCards = [
  makeCard({ org: '广發银行股份有限公司' }),
];

const normalized = normalizeCreditReportInstitutions(report);
assert.equal(normalized.report.creditDetail.revolvingLoansType2[0].org, '重庆美团三快小额贷款有限公司');
assert.equal(normalized.report.creditDetail.creditCards[0].org, '广发银行股份有限公司');
assert.equal(normalized.corrections.length >= 2, true);
assert.equal(normalized.corrections.every((item) => item.status === 'matched'), true);

const reportWithUnknown = createEmptyCreditReport();
reportWithUnknown.creditDetail.creditCards = [
  makeCard({ org: '某某测试机构' }),
];
const unknownNormalized = normalizeCreditReportInstitutions(reportWithUnknown);
assert.equal(unknownNormalized.report.creditDetail.creditCards[0].org, '某某测试机构');
assert.equal(unknownNormalized.corrections[0].status, 'unlisted');

const uncertainBank = normalizeInstitutionName('■京银行股份有限公司');
assert.equal(uncertainBank.matched, false);
assert.equal(uncertainBank.applied, false);
assert.equal(uncertainBank.status, 'review');
assert.equal(uncertainBank.normalized, '北京银行股份有限公司');
assert.equal(uncertainBank.candidates.includes('北京银行股份有限公司'), true);
assert.equal(uncertainBank.candidates.includes('南京银行股份有限公司'), true);

const reportWithSource = createEmptyCreditReport();
reportWithSource.creditDetail.revolvingLoansType2 = [
  makeRevolvingLoan({ org: '■京银行股份有限公司' }),
];
reportWithSource.provenance = {
  'creditDetail.revolvingLoansType2[0].org': {
    field: 'creditDetail.revolvingLoansType2[0].org',
    label: '循环贷账户二第1笔机构',
    source: 'doc-table',
    pageNum: 5,
    logicalPage: 12,
    precedingText: '账户7（授信协议标识：D20022210S0001）',
    confidence: 0.85,
  },
};
const sourceNormalized = normalizeCreditReportInstitutions(reportWithSource);
assert.equal(sourceNormalized.report.creditDetail.revolvingLoansType2[0].org, '■京银行股份有限公司');
assert.equal(sourceNormalized.corrections.length, 1);
assert.equal(sourceNormalized.corrections[0].field, 'creditDetail.revolvingLoansType2[0].org');
assert.equal(sourceNormalized.corrections[0].status, 'review');
assert.equal(sourceNormalized.corrections[0].applied, false);
assert.equal(sourceNormalized.corrections[0].sourceLabel, '循环贷账户二第1笔机构');
assert.equal(sourceNormalized.corrections[0].pageNum, 5);
assert.equal(sourceNormalized.corrections[0].logicalPage, 12);
assert.equal(sourceNormalized.corrections[0].precedingText, '账户7（授信协议标识：D20022210S0001）');
