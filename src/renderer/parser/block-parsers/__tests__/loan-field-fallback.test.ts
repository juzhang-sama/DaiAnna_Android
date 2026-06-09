import assert from 'node:assert/strict';
import type { AccountSegment, ContextTable } from '../../doc-table-bridge';
import { parseNonRevolvingLoanSegments } from '../non-revolving-loan-parser';
import { parseRevolvingLoan1Segments } from '../revolving-loan1-parser';
import { parseRevolvingLoan2Segments } from '../revolving-loan2-parser';

function contextTable(headers: string[], rows: string[][]): ContextTable {
  return {
    table: { headers, rows },
    pageNum: 0,
    logicalPage: 1,
    positionY: 100,
    positionX: 50,
    precedingText: '账户2',
    markdown: '',
  };
}

function segment(table: ContextTable): AccountSegment {
  return {
    category: 'nonRevolvingLoan',
    accountLabel: '账户2',
    tables: [table],
    logicalPage: 1,
    positionY: 100,
    positionX: 50,
    index: 0,
    source: 'anchor',
  };
}

const commonRows = [
  ['中国建设银行股份有限公司菏泽牡丹支行', 'A001', '2024.01.01', '2029.01.01', '50,000', '人民币元'],
  ['业务种类', '担保方式', '还款期数', '还款方式'],
  ['个人消费贷款', '信用/无担保', '60', '等额本息'],
  ['账户状态', '五级分类', '本月应还款', '应还款日', '本月实还款'],
  ['正常', '正常', '1,323', '15', '1,323'],
  ['余额', '剩余还款期数'],
  ['46,200', '36'],
];

const nonRevolving = parseNonRevolvingLoanSegments([segment(contextTable(
  ['管理机构', '账户标识', '开立日期', '到期日期', '借款金额', '账户币种'],
  commonRows,
))])[0];

assert.equal(nonRevolving.monthlyPayment, 1323);
assert.equal(nonRevolving.balance, 46200);
assert.equal(nonRevolving.remainTerms, 36);

const revolving1 = parseRevolvingLoan1Segments([segment(contextTable(
  ['管理机构', '账户标识', '开立日期', '到期日期', '借款金额', '账户币种'],
  commonRows,
))])[0];

assert.equal(revolving1.monthlyPayment, 1323);
assert.equal(revolving1.balance, 46200);
assert.equal(revolving1.remainTerms, 36);

const revolving2 = parseRevolvingLoan2Segments([segment(contextTable(
  ['管理机构', '账户标识', '开立日期', '到期日期', '账户授信额度', '账户币种'],
  commonRows,
))])[0];

assert.equal(revolving2.monthlyPayment, 1323);
assert.equal(revolving2.balance, 46200);
assert.equal(revolving2.remainTerms, 36);
