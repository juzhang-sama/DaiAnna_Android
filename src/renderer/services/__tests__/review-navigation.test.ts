import assert from 'node:assert/strict';
import {
  buildReviewFieldDomId,
  buildReviewNavigationTarget,
  normalizeReviewField,
} from '../review-navigation';

const loanTarget = buildReviewNavigationTarget('nonRevolvingLoans[2].monthlyPayment');
assert.equal(loanTarget.destinationTab, 'credit');
assert.equal(loanTarget.creditSectionKey, 'nonRevolvingLoan');
assert.equal(loanTarget.rowIndex, 2);
assert.equal(loanTarget.fieldName, 'monthlyPayment');
assert.equal(loanTarget.anchorId, 'review-field-nonRevolvingLoans-2-monthlyPayment');
assert.match(loanTarget.label, /非循环贷账户第 3 笔 本月应还/);

const prefixedTarget = buildReviewNavigationTarget('creditDetail.creditCards[0].usedAmount');
assert.equal(prefixedTarget.normalizedField, 'creditCards[0].usedAmount');
assert.equal(prefixedTarget.destinationTab, 'credit');
assert.equal(prefixedTarget.creditSectionKey, 'creditCard');
assert.equal(prefixedTarget.anchorId, 'review-field-creditCards-0-usedAmount');

const summaryTarget = buildReviewNavigationTarget('accountDerived.creditCard.accountCount');
assert.equal(summaryTarget.destinationTab, 'credit');
assert.equal(summaryTarget.creditSectionKey, 'summary');
assert.equal(summaryTarget.fieldName, 'accountCount');
assert.match(summaryTarget.label, /贷记卡汇总 账户数/);

const headerTarget = buildReviewNavigationTarget('header.reportNo');
assert.equal(headerTarget.destinationTab, 'personal');
assert.equal(headerTarget.fieldName, 'reportNo');
assert.equal(headerTarget.anchorId, 'review-field-header-reportNo');

const queryTarget = buildReviewNavigationTarget('queryRecord.selfQueries[0].queryOrg');
assert.equal(queryTarget.destinationTab, 'query');
assert.equal(queryTarget.querySectionKey, 'selfQuery');

assert.equal(normalizeReviewField('creditDetail.revolvingLoansType2[1].balance'), 'revolvingLoansType2[1].balance');
assert.equal(buildReviewFieldDomId('accountDerived.nonRevolvingLoan.accountCount'), 'review-field-accountDerived-nonRevolvingLoan-accountCount');
