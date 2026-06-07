import assert from 'node:assert/strict';
import type { ContextTable } from '../../doc-table-bridge';
import { parseNonRevolvingLoans } from '../non-revolving-loan-parser';

const fuzzyHeaderTable: ContextTable = {
  table: {
    headers: ['管机构', '账户状识', '开立日期', '到期日期', '借款金额', '账户币种'],
    rows: [
      ['通用测试融资有限公司', '010051024', '2023.02.12', '--', '12,345', '人民币元'],
      ['业务种类', '担保方式', '还款期数', '还款频率', '还款方式', '共同借款标志'],
      ['其他个人消费贷款', '信用/无担保', '12', '月', '分期等额本息', '无'],
      ['账户状态', '五级分类', '余额', '本月应还款', '应还款日'],
      ['结清', '正常', '0', '0', '2023.07.14'],
    ],
  },
  pageNum: 0,
  logicalPage: 1,
  positionY: 100,
  positionX: 50,
  precedingText: '账户1',
  markdown: '',
};

const loans = parseNonRevolvingLoans([fuzzyHeaderTable]);

assert.equal(loans.length, 1);
assert.equal(loans[0].org, '通用测试融资有限公司');
assert.equal(loans[0].loanAmount, 12345);
assert.equal(loans[0].status, '结清');
