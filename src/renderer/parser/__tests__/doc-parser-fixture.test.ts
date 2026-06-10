import assert from 'node:assert/strict';
import type { DocLayout, DocParserResult, DocTable } from '../../../shared/doc-parser-types';
import { parseCreditReport } from '../index';
import { extractTablesFromDoc, groupAccountTables } from '../doc-table-bridge';
import { classifyTables } from '../table-classifier';
import { evaluateOcrQuality } from '../ocr-quality';
import { computeSummaryFromAccounts } from '../block-parsers/summary-from-accounts';

const fullText = [
  '个人信用报告',
  '报告编号：RPT-001',
  '三 信贷交易信息明细',
  '（五）相关还款责任信息',
  '四 查询记录',
  '机构查询记录明细',
  '报告说明',
].join('\n');

function textLayout(id: string, text: string, y: number, x = 50): DocLayout {
  return {
    layout_id: id,
    text,
    position: [x, y, 300, 20],
    type: 'para',
    sub_type: '',
    parent: '',
    children: [],
  };
}

function tableLayout(id: string, y: number, x = 50): DocLayout {
  return {
    layout_id: id,
    text: '',
    position: [x, y, 300, 40],
    type: 'table',
    sub_type: '',
    parent: '',
    children: [],
  };
}

function docTable(id: string, markdown: string, y: number, x = 50): DocTable {
  return {
    layout_id: id,
    markdown,
    position: [x, y, 300, 40],
    cells: [],
    matrix: [],
    merge_table: '',
  };
}

function footerLayout(id: string, text: string, y: number, x: number): DocLayout {
  return {
    ...textLayout(id, text, y, x),
    sub_type: 'footer',
  };
}

function simpleTable(label: string): string {
  return [
    `| ${label} | 值 |`,
    '| --- | --- |',
    '| x | y |',
  ].join('\n');
}

function createFixtureDoc(): DocParserResult {
  const repayHeader = [
    '| 管理机构 | 业务种类 | 开立日期 | 到期日期 | 责任人类型 | 还款责任金额 | 币种 | 保证合同编号 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ].join('\n');

  const repayData = [
    '| 测试银行股份有限公司 | 个人住房贷款 | 2025.01.01 | 2035.01.01 | 保证人 | 100,000 | 人民币 | HT001 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 主业务借款人 | 主业务借款人证件类型 | 主业务借款人证件号码 |',
    '| 张三 | 身份证 | 110101199001011234 |',
    '| 主业务状态 | 主业务状态 | 主业务状态 |',
    '| 五级分类 | 余额 | 还款状态 |',
    '| 正常 | 80,000 | 正常 |',
  ].join('\n');

  const queryDetail = [
    '| 查询日期 | 查询机构 | 查询原因 |',
    '| --- | --- | --- |',
    '| 2026.05.01 | A银行 | 贷款审批 |',
  ].join('\n');

  return {
    file_name: 'fixture.pdf',
    file_id: 'fixture',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: fullText,
      layouts: [
        textLayout('l-credit-detail', '三 信贷交易信息明细', 80),
        textLayout('l-repay-section', '（五）相关还款责任信息', 120),
        tableLayout('t-repay-header', 140),
        tableLayout('t-repay-data', 180),
        textLayout('l-query-record', '四 查询记录', 300),
        textLayout('l-query-detail', '机构查询记录明细', 330),
        tableLayout('t-query-detail', 360),
      ],
      tables: [
        docTable('t-repay-header', repayHeader, 140),
        docTable('t-repay-data', repayData, 180),
        docTable('t-query-detail', queryDetail, 360),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createCombinedRepayFixtureDoc(): DocParserResult {
  const repayCombined = [
    '| 管理机构 | 业务种类 | 开立日期 | 到期日期 | 责任人类型 | 还款责任金额 | 币种 | 保证合同编号 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 测试银行股份有限公司 | 个人住房贷款 | 2025.01.01 | 2035.01.01 | 保证人 | 100,000 | 人民币 | HT001 |',
    '| 主业务借款人 | 主业务借款人证件类型 | 主业务借款人证件号码 |',
    '| 张三 | 身份证 | 110101199001011234 |',
    '| 主业务状态 | 主业务状态 | 主业务状态 |',
    '| 五级分类 | 余额 | 还款状态 |',
    '| 正常 | 80,000 | 正常 |',
  ].join('\n');

  const queryDetail = [
    '| 编号 | 查询日期 | 查询机构 | 查询原因 |',
    '| --- | --- | --- | --- |',
    '| 1 | 2026.05.01 | A银行 | 贷款审批 |',
  ].join('\n');

  return {
    file_name: 'fixture-combined.pdf',
    file_id: 'fixture-combined',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: fullText,
      layouts: [
        textLayout('l-credit-detail', '三 信贷交易信息明细', 80),
        textLayout('l-repay-section', '（五）相关还款责任信息', 120),
        tableLayout('t-repay-combined', 140),
        textLayout('l-query-record', '四 查询记录', 300),
        textLayout('l-query-detail', '机构查询记录明细', 330),
        tableLayout('t-query-detail', 360),
      ],
      tables: [
        docTable('t-repay-combined', repayCombined, 140),
        docTable('t-query-detail', queryDetail, 360),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createMonthlyFixtureDoc(): DocParserResult {
  const accountTable = [
    '| 账户信息 | 账户信息 | 账户信息 | 账户信息 | 账户信息 | 账户信息 | 账户信息 | 账户信息 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 管理机构 | 借款金额 | 账户状态 | 账户状态 | 余额 | 余额 | 本月应还款 | 本月应还款 |',
    '| 测试银行 | 20,000 | 正常 | 正常 | 11.576 | 11.576 | 706 | 706 |',
  ].join('\n');

  return {
    file_name: 'fixture-monthly.pdf',
    file_id: 'fixture-monthly',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '个人信用报告',
        '三 信贷交易信息明细',
        '（一）非循环贷账户',
        '账户1',
        '四 查询记录',
      ].join('\n'),
      layouts: [
        textLayout('l-credit-detail', '三 信贷交易信息明细', 80),
        textLayout('l-non-revolving', '（一）非循环贷账户', 100),
        textLayout('l-account-1', '账户1', 120),
        tableLayout('t-account-1', 140),
        textLayout('l-query-record', '四 查询记录', 300),
      ],
      tables: [
        docTable('t-account-1', accountTable, 140),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createBareMonthlyFragmentDoc(): DocParserResult {
  const accountTable = [
    '| 管理机构 | 借款金额 | 账户状态 | 余额 | 本月应还款 | 应还款日 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 测试银行 | 20,000 | 正常 | 11,576 | 706 | 2026.04.04 |',
  ].join('\n');

  return {
    file_name: 'fragment-account.jpg',
    file_id: 'fragment-account',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '账户1',
      layouts: [
        textLayout('l-account-1', '账户1', 120),
        tableLayout('t-account-1', 140),
      ],
      tables: [
        docTable('t-account-1', accountTable, 140),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createSummaryBalanceRepairDoc(): DocParserResult {
  const summaryTable = [
    '| 非循环贷账户信息汇总 | 非循环贷账户信息汇总 | 非循环贷账户信息汇总 | 非循环贷账户信息汇总 | 非循环贷账户信息汇总 |',
    '| --- | --- | --- | --- | --- |',
    '| 管理机构数 | 账户数 | 借款金额 | 余额 | 最近6个月平均应还款 |',
    '| 1 | 1 | 30,000 | 7,871 | 2,713 |',
  ].join('\n');

  const accountTable = [
    '| 管理机构 | 借款金额 | 开立日期 | 到期日期 | 账户币种 |',
    '| --- | --- | --- | --- | --- |',
    '| 测试银行 | 30,000 | 2020.01.01 | 2030.01.01 | 人民币 |',
    '| 业务种类 | 担保方式 | 还款期数 | 还款方式 |',
    '| 个人消费贷款 | 信用/免担保 | 120 | 等额本息 |',
    '| 账户状态 | 五级分类 | 余额 | 本月应还款 | 应还款日 |',
    '| 正常 | 正常 | 7,87 | 2,713 | 2026.04.04 |',
  ].join('\n');

  return {
    file_name: 'summary-balance-repair.pdf',
    file_id: 'summary-balance-repair',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '个人信用报告',
        '三 信贷交易信息明细',
        '（一）非循环贷账户',
        '账户1',
        '四 查询记录',
      ].join('\n'),
      layouts: [
        textLayout('l-credit-detail-repair', '三 信贷交易信息明细', 80),
        textLayout('l-non-repair', '（一）非循环贷账户', 100),
        tableLayout('t-summary-repair', 120),
        textLayout('l-account-repair', '账户1', 180),
        tableLayout('t-account-repair', 210),
        textLayout('l-query-repair', '四 查询记录', 420),
      ],
      tables: [
        docTable('t-summary-repair', summaryTable, 120),
        docTable('t-account-repair', accountTable, 210),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createCreditCardMonthlyFixtureDoc(): DocParserResult {
  const accountTable = [
    '| 发卡机构 | 账户标识 | 开立日期 | 账户授信额度 | 共享授信额度 | 币种 | 业务种类 | 担保方式 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 测试银行 | C001 | 2020.01.01 | 50,000 | -- | 人民币 | 贷记卡 | 信用/免担保 |',
    '| 业务种类 | 担保方式 |  |  |  |  |  |  |',
    '| 账户状态 | 已用额度 | 账单日 | 本月应还款 | 本月实还款 | 最近一次还款日期 | 当前逾期期数 | 当前逾期总额 |',
    '| 正常 | 12,000 | 2026.05.16 | 1,200 | 1,000 | 2026.05.15 | 0 | 0 |',
  ].join('\n');

  return {
    file_name: 'fixture-card-monthly.pdf',
    file_id: 'fixture-card-monthly',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '个人信用报告',
        '三 信贷交易信息明细',
        '（四）贷记卡账户',
        '账户1',
        '四 查询记录',
      ].join('\n'),
      layouts: [
        textLayout('l-credit-detail', '三 信贷交易信息明细', 80),
        textLayout('l-card', '（四）贷记卡账户', 100),
        textLayout('l-account-1', '账户1', 120),
        tableLayout('t-card-account-1', 140),
        textLayout('l-query-record', '四 查询记录', 300),
      ],
      tables: [
        docTable('t-card-account-1', accountTable, 140),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createBareQueryFragmentDoc(): DocParserResult {
  const queryDetail = [
    '| 编号 | 查询日期 | 查询机构 | 查询原因 |',
    '| --- | --- | --- | --- |',
    '| 1 | 2026.05.01 | A银行 | 贷款审批 |',
  ].join('\n');

  return {
    file_name: 'fragment-query.png',
    file_id: 'fragment-query',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '',
      layouts: [
        tableLayout('t-query-detail', 120),
      ],
      tables: [
        docTable('t-query-detail', queryDetail, 120),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createReadingOrderFixtureDoc(): DocParserResult {
  return {
    file_name: 'reading-order.pdf',
    file_id: 'reading-order',
    pages: [
      {
        page_id: 'physical-first-actual-3-4',
        page_num: 0,
        text: '',
        layouts: [
          textLayout('l-p4-title', '第4页右栏标题', 90, 520),
          tableLayout('t-p4', 110, 520),
          footerLayout('f-p4', '第4页，共4页', 1120, 610),
          textLayout('l-p3-title', '第3页左栏标题', 90, 50),
          tableLayout('t-p3', 110, 50),
          footerLayout('f-p3', '第3页，共4页', 1120, 180),
        ],
        tables: [
          docTable('t-p3', simpleTable('P3'), 110, 50),
          docTable('t-p4', simpleTable('P4'), 110, 520),
        ],
        images: [],
        meta: {
          page_width: 842,
          page_height: 1191,
          is_scan: true,
          page_angle: 0,
          page_type: 'normal',
        },
      },
      {
        page_id: 'physical-second-actual-1-2',
        page_num: 1,
        text: '',
        layouts: [
          tableLayout('t-p2', 100, 520),
          textLayout('l-p2-title', '第2页右栏标题', 80, 520),
          footerLayout('f-p2', '第2页，共4页', 1120, 610),
          tableLayout('t-p1-b', 220, 50),
          textLayout('l-p1-b-title', '第1页左栏标题B', 200, 50),
          tableLayout('t-p1-a', 120, 50),
          textLayout('l-p1-a-title', '第1页左栏标题A', 100, 50),
          footerLayout('f-p1', '第1页，共4页', 1120, 180),
        ],
        tables: [
          docTable('t-p1-a', simpleTable('P1A'), 120, 50),
          docTable('t-p1-b', simpleTable('P1B'), 220, 50),
          docTable('t-p2', simpleTable('P2'), 100, 520),
        ],
        images: [],
        meta: {
          page_width: 842,
          page_height: 1191,
          is_scan: true,
          page_angle: 0,
          page_type: 'normal',
        },
      },
    ],
  };
}

function createSplitAccountAcrossColumnsDoc(): DocParserResult {
  const accountHead = [
    '| 管理机构 | 借款金额 | 开立日期 | 到期日期 | 账户币种 |',
    '| --- | --- | --- | --- | --- |',
    '| 测试银行 | 20,000 | 2020.01.01 | 2030.01.01 | 人民币 |',
  ].join('\n');

  const accountTail = [
    '| 业务种类 | 担保方式 | 还款期数 | 还款方式 |',
    '| --- | --- | --- | --- |',
    '| 个人消费贷款 | 信用/免担保 | 120 | 等额本息 |',
    '| 账户状态 | 五级分类 | 余额 | 本月应还款 | 应还款日 |',
    '| 正常 | 正常 | 11,576 | 706 | 2026.04.04 |',
  ].join('\n');

  return {
    file_name: 'split-account-columns.pdf',
    file_id: 'split-account-columns',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '个人信用报告',
        '三 信贷交易信息明细',
        '（一）非循环贷账户',
        '账户1',
      ].join('\n'),
      layouts: [
        textLayout('l-credit-detail', '三 信贷交易信息明细', 80, 50),
        textLayout('l-non-revolving', '（一）非循环贷账户', 110, 50),
        textLayout('l-account-1', '账户1', 140, 50),
        tableLayout('t-account-head', 980, 50),
        footerLayout('f-p1', '第1页，共2页', 1120, 180),
        tableLayout('t-account-tail', 80, 520),
        footerLayout('f-p2', '第2页，共2页', 1120, 610),
      ],
      tables: [
        docTable('t-account-head', accountHead, 980, 50),
        docTable('t-account-tail', accountTail, 80, 520),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createHorizontallySplitQueryDoc(): DocParserResult {
  const queryLeft = [
    '| 编号 | 查询日期 |',
    '| --- | --- |',
    '| 1 | 2026.05.01 |',
  ].join('\n');

  const queryRight = [
    '| 查询机构 | 查询原因 |',
    '| --- | --- |',
    '| A银行 | 贷款审批 |',
  ].join('\n');

  return {
    file_name: 'split-query-horizontal.pdf',
    file_id: 'split-query-horizontal',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '个人信用报告',
        '四 查询记录',
        '机构查询记录明细',
      ].join('\n'),
      layouts: [
        textLayout('l-query-record', '四 查询记录', 90, 50),
        textLayout('l-query-detail', '机构查询记录明细', 120, 50),
        tableLayout('t-query-left', 150, 50),
        tableLayout('t-query-right', 150, 260),
      ],
      tables: [
        docTable('t-query-left', queryLeft, 150, 50),
        docTable('t-query-right', queryRight, 150, 260),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createAsymmetricFooterColumnsDoc(): DocParserResult {
  const loanTable = (org: string, amount: string) => [
    '| 管理机构 | 账户标识 | 开立日期 | 到期日期 | 借款金额 | 账户币种 |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${org} | A001 | 2023.01.01 | 2024.01.01 | ${amount} | 人民币元 |`,
    '| 业务种类 | 担保方式 | 还款期数 | 还款频率 | 还款方式 | 共同借款标志 |',
    '| 其他个人消费贷款 | 信用/免担保 | 12 | 月 | 等额本息 | 无 |',
    '| 账户状态 | 五级分类 | 余额 | 本月应还款 | 应还款日 |',
    '| 正常 | 正常 | 1,000 | 100 | 2026.04.04 |',
  ].join('\n');

  return {
    file_name: 'asymmetric-columns.pdf',
    file_id: 'asymmetric-columns',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '',
      layouts: [
        textLayout('l-non-revolving-wide', '（一）非循环贷账户', 100, 200),
        textLayout('l-non-account-1-wide', '账户1', 140, 200),
        tableLayout('t-non-account-1-wide', 170, 200),
        textLayout('l-non-account-2-wide', '账户2', 450, 200),
        tableLayout('t-non-account-2-wide', 480, 200),
        footerLayout('f-wide-left', '第5页，共16页', 2620, 613),
        textLayout('l-revolving-wide', '循环贷账户一', 120, 1358),
        textLayout('l-revolving-account-wide', '账户1', 160, 1358),
        tableLayout('t-revolving-account-wide', 190, 1358),
        footerLayout('f-wide-right', '第6页，共16页', 2580, 1839),
      ],
      tables: [
        docTable('t-non-account-1-wide', loanTable('左栏银行一', '30,000'), 170, 200),
        docTable('t-non-account-2-wide', loanTable('左栏银行二', '60,000'), 480, 200),
        docTable('t-revolving-account-wide', loanTable('右栏银行', '40,000'), 190, 1358),
      ],
      images: [],
      meta: {
        page_width: 4000,
        page_height: 3000,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createEightNonRevolvingAccountsDoc(): DocParserResult {
  const accountLabels = ['账户 1', '账户２', '账戶3', '帐户4', '账户5', '账户6', '账户7', '账户8'];

  const accountMarkdown = (idx: number) => [
    '| 管理机构 | 借款金额 | 开立日期 | 到期日期 | 账户币种 |',
    '| --- | --- | --- | --- | --- |',
    `| 测试银行${idx} | ${idx}0,000 | 2020.01.01 | 2030.01.01 | 人民币 |`,
    '| 业务种类 | 担保方式 | 还款期数 | 还款方式 |',
    '| 个人消费贷款 | 信用/免担保 | 120 | 等额本息 |',
    '| 账户状态 | 五级分类 | 余额 | 本月应还款 | 应还款日 |',
    `| 正常 | 正常 | ${idx},000 | ${idx}00 | 2026.04.04 |`,
  ].join('\n');

  const layouts: DocLayout[] = [
    textLayout('l-credit-detail-8', '三 信贷交易信息明细', 60),
    textLayout('l-non-revolving-8', '（一）非循环贷账户', 90),
  ];
  const tables: DocTable[] = [];

  accountLabels.forEach((label, index) => {
    const y = 120 + index * 90;
    layouts.push(textLayout(`l-account-8-${index + 1}`, label, y));
    layouts.push(tableLayout(`t-account-8-${index + 1}`, y + 20));
    tables.push(docTable(`t-account-8-${index + 1}`, accountMarkdown(index + 1), y + 20));
  });

  return {
    file_name: 'eight-non-revolving.pdf',
    file_id: 'eight-non-revolving',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '个人信用报告',
        '三 信贷交易信息明细',
        '（一）非循环贷账户',
        ...accountLabels,
      ].join('\n'),
      layouts,
      tables,
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createCategoryPositionBoundaryDoc(): DocParserResult {
  const loanTable = (org: string, amount: string) => [
    '| 管理机构 | 借款金额 | 开立日期 | 到期日期 | 账户币种 |',
    '| --- | --- | --- | --- | --- |',
    `| ${org} | ${amount} | 2020.01.01 | 2030.01.01 | 人民币 |`,
    '| 业务种类 | 担保方式 | 还款期数 | 还款方式 |',
    '| 个人消费贷款 | 信用/免担保 | 120 | 等额本息 |',
  ].join('\n');

  return {
    file_name: 'category-position-boundary.pdf',
    file_id: 'category-position-boundary',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '三 信贷交易信息明细',
        '（一）非循环贷账户',
        '账户1',
        '二、循环贷账户一',
        '账户1',
      ].join('\n'),
      layouts: [
        textLayout('l-credit-detail-boundary', '三 信贷交易信息明细', 60, 50),
        textLayout('l-non-boundary', '（一）非循环贷账户', 100, 50),
        textLayout('l-non-account-boundary', '账户1', 130, 50),
        tableLayout('t-non-boundary', 160, 50),
        footerLayout('f-boundary-left', '第1页，共2页', 1120, 180),
        textLayout('l-rev1-boundary', '二、循环贷账户一', 90, 520),
        textLayout('l-rev1-account-boundary', '账户1', 120, 520),
        tableLayout('t-rev1-boundary', 150, 520),
        footerLayout('f-boundary-right', '第2页，共2页', 1120, 610),
      ],
      tables: [
        docTable('t-non-boundary', loanTable('非循环测试银行', '20,000'), 160, 50),
        docTable('t-rev1-boundary', loanTable('循环一测试银行', '40,000'), 150, 520),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createAccountContinuationOutsideClassifierDoc(): DocParserResult {
  const accountHead = [
    '| 管理机构 | 借款金额 | 开立日期 | 到期日期 | 账户币种 |',
    '| --- | --- | --- | --- | --- |',
    '| 测试银行 | 20,000 | 2020.01.01 | 2030.01.01 | 人民币 |',
    '| 业务种类 | 担保方式 | 还款期数 | 还款方式 |',
    '| 个人消费贷款 | 信用/免担保 | 120 | 等额本息 |',
  ].join('\n');

  const accountTail = [
    '| 账户状态 | 五级分类 | 余额 | 本月应还款 | 应还款日 |',
    '| --- | --- | --- | --- | --- |',
    '| 正常 | 正常 | 11,576 | 706 | 2026.04.04 |',
  ].join('\n');

  return {
    file_name: 'account-continuation-outside-classifier.pdf',
    file_id: 'account-continuation-outside-classifier',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '三 信贷交易信息明细',
        '（一）非循环贷账户',
        '账户1',
        '续表',
      ].join('\n'),
      layouts: [
        textLayout('l-credit-detail-continuation', '三 信贷交易信息明细', 60, 50),
        textLayout('l-non-continuation', '（一）非循环贷账户', 100, 50),
        textLayout('l-account-continuation', '账户1', 130, 50),
        tableLayout('t-account-continuation-head', 160, 50),
        footerLayout('f-continuation-left', '第1页，共2页', 1120, 180),
        textLayout('l-continuation-note', '续表', 80, 520),
        tableLayout('t-account-continuation-tail', 110, 520),
        footerLayout('f-continuation-right', '第2页，共2页', 1120, 610),
      ],
      tables: [
        docTable('t-account-continuation-head', accountHead, 160, 50),
        docTable('t-account-continuation-tail', accountTail, 110, 520),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createRevolvingLoan1SplitWithoutNewAnchorDoc(): DocParserResult {
  const accountHead = [
    '| 管理机构 | 借款金额 | 开立日期 | 到期日期 | 账户币种 |',
    '| --- | --- | --- | --- | --- |',
    '| 循环一测试银行 | 40,000 | 2020.01.01 | 2030.01.01 | 人民币 |',
    '| 业务种类 | 担保方式 | 还款期数 | 还款方式 |',
    '| 个人消费贷款 | 信用/免担保 | 120 | 等额本息 |',
  ].join('\n');

  const accountTailWithPrimaryHeader = [
    '| 管理机构 | 借款金额 | 账户状态 | 五级分类 | 余额 | 本月应还款 | 应还款日 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 循环一测试银行 | 40,000 | 正常 | 正常 | 5,000 | 800 | 2026.04.04 |',
  ].join('\n');

  return {
    file_name: 'revolving-loan1-split-without-new-anchor.pdf',
    file_id: 'revolving-loan1-split-without-new-anchor',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '三 信贷交易信息明细',
        '（二）循环贷账户一',
        '账户1',
      ].join('\n'),
      layouts: [
        textLayout('l-credit-detail-rev1-split', '三 信贷交易信息明细', 60),
        textLayout('l-rev1-split', '（二）循环贷账户一', 100),
        textLayout('l-rev1-account-split', '账户1', 130),
        tableLayout('t-rev1-split-head', 160),
        tableLayout('t-rev1-split-tail', 260),
      ],
      tables: [
        docTable('t-rev1-split-head', accountHead, 160),
        docTable('t-rev1-split-tail', accountTailWithPrimaryHeader, 260),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createRepeatedAnchorSeparateAccountsDoc(): DocParserResult {
  const accountTable = (org: string, accountId: string, amount: string, openDate: string) => [
    '| 管理机构 | 账户标识 | 开立日期 | 到期日期 | 借款金额 | 账户币种 |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${org} | ${accountId} | ${openDate} | -- | ${amount} | 人民币元 |`,
    '| 业务种类 | 担保方式 | 还款期数 | 还款方式 |',
    '| 个人消费贷款 | 信用/免担保 | 12 | 等额本息 |',
  ].join('\n');

  return {
    file_name: 'repeated-anchor-separate-accounts.pdf',
    file_id: 'repeated-anchor-separate-accounts',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: [
        '三 信贷交易信息明细',
        '（一）非循环贷账户',
        '账户6',
      ].join('\n'),
      layouts: [
        textLayout('l-credit-detail-repeated-anchor', '三 信贷交易信息明细', 60),
        textLayout('l-non-repeated-anchor', '（一）非循环贷账户', 100),
        textLayout('l-account-repeated-anchor', '账户6', 130),
        tableLayout('t-repeated-anchor-1', 160),
        tableLayout('t-repeated-anchor-2', 260),
      ],
      tables: [
        docTable('t-repeated-anchor-1', accountTable('北京中关村银行股份有限公司', 'A001', '40,000', '2023.02.12'), 160),
        docTable('t-repeated-anchor-2', accountTable('威海银行股份有限公司', 'A002', '40,000', '2023.08.04'), 260),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createWidePageWithoutFooterDoc(): DocParserResult {
  return {
    file_name: 'wide-no-footer.pdf',
    file_id: 'wide-no-footer',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '',
      layouts: [
        textLayout('l-left-a', '左栏标题A', 100, 300),
        tableLayout('t-left-a', 130, 300),
        textLayout('l-left-b', '左栏标题B', 900, 300),
        tableLayout('t-left-b', 930, 300),
        textLayout('l-right-a', '右栏标题A', 120, 1500),
        tableLayout('t-right-a', 150, 1500),
      ],
      tables: [
        docTable('t-left-a', simpleTable('LEFT_A'), 130, 300),
        docTable('t-left-b', simpleTable('LEFT_B'), 930, 300),
        docTable('t-right-a', simpleTable('RIGHT_A'), 150, 1500),
      ],
      images: [],
      meta: {
        page_width: 3000,
        page_height: 4000,
        is_scan: true,
        page_angle: 0,
        page_type: 'scan',
      },
    }],
  };
}

function createMismatchedFooterPageDoc(): DocParserResult {
  return {
    file_name: 'mismatched-footer.pdf',
    file_id: 'mismatched-footer',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '',
      layouts: [
        textLayout('l-left-mismatch', '左栏标题', 100, 300),
        tableLayout('t-left-mismatch', 130, 300),
        footerLayout('f-left-mismatch', '第1页，共16页', 2574, 770),
        textLayout('l-right-mismatch', '右栏标题', 100, 1500),
        tableLayout('t-right-mismatch', 130, 1500),
        footerLayout('f-right-mismatch', '第12页，共16页', 2566, 1980),
      ],
      tables: [
        docTable('t-left-mismatch', simpleTable('LEFT_11'), 130, 300),
        docTable('t-right-mismatch', simpleTable('RIGHT_12'), 130, 1500),
      ],
      images: [],
      meta: {
        page_width: 3000,
        page_height: 4000,
        is_scan: true,
        page_angle: 0,
        page_type: 'scan',
      },
    }],
  };
}

function createCreditCardTable(
  org: string,
  accountId: string,
  limit: string,
  status = '正常',
  usedAmount = '0',
  monthlyPayment = '0',
  currency = '人民币元',
): string {
  return [
    '| 发卡机构 | 账户标识 | 开立日期 | 账户授信额度 | 共享授信额度 | 币种 | 业务种类 | 担保方式 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    `| ${org} | ${accountId} | 2017.12.18 | ${limit} | 0 | ${currency} | 贷记卡 | 信用/无担保 |`,
    '| 账户状态 | 已用额度 | 账单日 | 本月应还款 | 本月实还款 | 最近一次还款日期 | 当前逾期期数 | 当前逾期总额 |',
    `| ${status} | ${usedAmount} | 2026.05.16 | ${monthlyPayment} | 0 | 2026.05.01 | 0 | 0 |`,
  ].join('\n');
}

function createSplitCreditCardLimitDoc(): DocParserResult {
  return {
    file_name: 'split-card-limit.pdf',
    file_id: 'split-card-limit',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '三 信贷交易信息明细\n（四）贷记卡账户\n账户3（授信协议标识：B10711000H00011）\n四 查询记录',
      layouts: [
        textLayout('l-credit-detail-split-card', '三 信贷交易信息明细', 80),
        textLayout('l-card-split-card', '（四）贷记卡账户', 110),
        textLayout('l-account-split-card', '账户3（授信协议标识：B10711000H00011）', 140),
        tableLayout('t-card-split-left', 170, 80),
        tableLayout('t-card-split-right', 170, 460),
        textLayout('l-query-split-card', '四 查询记录', 360),
      ],
      tables: [
        docTable(
          't-card-split-left',
          [
            '| 发卡机构 | 账户标识 | 开立日期 |',
            '| --- | --- | --- |',
            '| 中国光大银行股份有限公司 | B10711000H00011 | 2017.12.18 |',
          ].join('\n'),
          170,
          80,
        ),
        docTable(
          't-card-split-right',
          [
            '| 账户授信额度 | 共享授信额度 | 币种 | 业务种类 | 担保方式 |',
            '| --- | --- | --- | --- | --- |',
            '| 50,000 | 0 | 人民币元 | 贷记卡 | 信用/无担保 |',
            '| 账户状态 | 已用额度 | 账单日 | 本月应还款 | 本月实还款 |',
            '| 正常 | 12,000 | 2026.05.16 | 1,200 | 0 |',
          ].join('\n'),
          170,
          460,
        ),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createManyCreditCardsWithDamagedAnchorsDoc(): DocParserResult {
  const issuerA = '同一发卡银行股份有限公司';
  const issuerB = '另一发卡银行股份有限公司';
  const layouts: DocLayout[] = [
    textLayout('l-credit-detail-many-cards', '三 信贷交易信息明细', 80),
    textLayout('l-card-many-cards', '（四）贷记卡账户', 110),
    textLayout('l-account-card-1', '账户1', 140),
  ];
  const tables: DocTable[] = [];

  for (let i = 1; i <= 11; i++) {
    const y = 160 + i * 70;
    if (i > 1) layouts.push(textLayout(`l-card-noise-${i}`, i % 2 === 0 ? '-' : '4x', y - 20));
    layouts.push(tableLayout(`t-card-${i}`, y));
    tables.push(docTable(
      `t-card-${i}`,
      createCreditCardTable(i === 2 ? issuerB : issuerA, `B${String(i).padStart(10, '0')}`, `${10000 + i * 1000}`),
      y,
    ));
  }

  layouts.push(textLayout('l-query-after-many-cards', '四 查询记录', 980));

  return {
    file_name: 'many-cards-damaged-anchors.pdf',
    file_id: 'many-cards-damaged-anchors',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '三 信贷交易信息明细\n（四）贷记卡账户\n账户1\n四 查询记录',
      layouts,
      tables,
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createHeaderlessCreditCardValueDoc(): DocParserResult {
  const headerlessCard = [
    '| 中国建设银 开发分 | B10411C00TT 00011566280 2017.12.18 Q002127000 39878963 | 15,000 | 人民币元 | 贷记卡 | 信用无担保 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 账户状态 | 余额 | ：已用额度 | 剩余分期期数 | 平均6个月 | 最大使用额度 |',
    '| 正常 | 0 | 0 | 0 | 98 | 580 |',
    '| 账单日 | 本月应还款 | 本月实还款 | 最近一次还款日期 | 当前逾期期数 | 当前逾期总额 |',
    '| 2026.05.12 | 0 | 0 | 2026.04.01 | 0 | 0 |',
  ].join('\n');

  return {
    file_name: 'headerless-card-value.pdf',
    file_id: 'headerless-card-value',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '三 信贷交易信息明细\n（四）贷记卡账户\n账户2\n四 查询记录',
      layouts: [
        textLayout('l-credit-detail-headerless-card', '三 信贷交易信息明细', 80),
        textLayout('l-card-headerless-card', '（四）贷记卡账户', 110),
        textLayout('l-account-headerless-card', '账户2', 140),
        tableLayout('t-headerless-card', 170),
        textLayout('l-query-headerless-card', '四 查询记录', 320),
      ],
      tables: [
        docTable('t-headerless-card', headerlessCard, 170),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

function createMixedCreditCardStatusDoc(): DocParserResult {
  return {
    file_name: 'mixed-card-status.pdf',
    file_id: 'mixed-card-status',
    pages: [{
      page_id: 'page-1',
      page_num: 0,
      text: '三 信贷交易信息明细\n（四）贷记卡账户\n账户1\n账户2\n四 查询记录',
      layouts: [
        textLayout('l-credit-detail-mixed-cards', '三 信贷交易信息明细', 80),
        textLayout('l-card-mixed-cards', '（四）贷记卡账户', 110),
        textLayout('l-account-mixed-card-1', '账户1', 140),
        tableLayout('t-mixed-card-1', 170),
        textLayout('l-account-mixed-card-2', '账户2', 250),
        tableLayout('t-mixed-card-2', 280),
        textLayout('l-query-mixed-cards', '四 查询记录', 380),
      ],
      tables: [
        docTable(
          't-mixed-card-1',
          createCreditCardTable('广发银行股份有限公司', 'B10411C0001', '50,000', '正常', '12,000', '1,200'),
          170,
        ),
        docTable(
          't-mixed-card-2',
          createCreditCardTable('招商银行股份有限公司', 'B10411C0002', '100,000', '结清', '40,000', '4,000'),
          280,
        ),
      ],
      images: [],
      meta: {
        page_width: 842,
        page_height: 1191,
        is_scan: true,
        page_angle: 0,
        page_type: 'normal',
      },
    }],
  };
}

const docTables = extractTablesFromDoc(createFixtureDoc());
const classified = classifyTables(docTables);

assert.equal(classified.creditAccount.length, 1);
assert.equal(classified.queryDetail.length, 1);

const readingOrderTables = extractTablesFromDoc(createReadingOrderFixtureDoc());
assert.deepEqual(readingOrderTables.map((table) => table.table.headers[0]), ['P1A', 'P1B', 'P2', 'P3', 'P4']);
assert.deepEqual(readingOrderTables.map((table) => table.logicalPage), [1, 1, 2, 3, 4]);
assert.deepEqual(readingOrderTables.map((table) => table.precedingText), [
  '第1页左栏标题A',
  '第1页左栏标题B',
  '第2页右栏标题',
  '第3页左栏标题',
  '第4页右栏标题',
]);

const wideNoFooterTables = extractTablesFromDoc(createWidePageWithoutFooterDoc());
assert.deepEqual(wideNoFooterTables.map((table) => table.table.headers[0]), ['LEFT_A', 'LEFT_B', 'RIGHT_A']);
assert.deepEqual(wideNoFooterTables.map((table) => table.logicalPage), [1, 1, 2]);

const mismatchedFooterTables = extractTablesFromDoc(createMismatchedFooterPageDoc());
assert.deepEqual(mismatchedFooterTables.map((table) => table.logicalPage), [11, 12]);

const splitAccountTables = extractTablesFromDoc(createSplitAccountAcrossColumnsDoc());
const splitAccountParsed = parseCreditReport('', undefined, createSplitAccountAcrossColumnsDoc());
const splitLoan = splitAccountParsed.report.creditDetail.nonRevolvingLoans[0];

assert.equal(splitAccountTables.length, 1);
assert.equal(splitAccountTables[0].fragmentCount, 2);
assert.equal(splitAccountTables[0].fragmentMergeStrategy, 'vertical');
assert.equal(splitAccountTables[0].table.rows.length, 5);
assert.equal(splitLoan.org, '测试银行');
assert.equal(splitLoan.loanAmount, 20000);
assert.equal(splitLoan.monthlyPayment, 706);

const splitQueryTables = extractTablesFromDoc(createHorizontallySplitQueryDoc());
const splitQueryParsed = parseCreditReport('', undefined, createHorizontallySplitQueryDoc());

assert.equal(splitQueryTables.length, 1);
assert.equal(splitQueryTables[0].fragmentCount, 2);
assert.equal(splitQueryTables[0].fragmentMergeStrategy, 'horizontal');
assert.deepEqual(splitQueryTables[0].table.headers, ['编号', '查询日期', '查询机构', '查询原因']);
assert.equal(splitQueryParsed.report.queryRecord.orgQueries.length, 1);
assert.equal(splitQueryParsed.report.queryRecord.orgQueries[0].queryReason, '贷款审批');

const asymmetricTables = extractTablesFromDoc(createAsymmetricFooterColumnsDoc());
const asymmetricGroups = groupAccountTables(classifyTables(asymmetricTables).creditAccount);

assert.deepEqual(asymmetricTables.map((table) => table.logicalPage), [5, 5, 6]);
assert.equal(asymmetricGroups.nonRevolvingLoan.length, 2);
assert.equal(asymmetricGroups.revolvingLoan1.length, 1);

const eightAccountTables = extractTablesFromDoc(createEightNonRevolvingAccountsDoc());
const eightAccountClassified = classifyTables(eightAccountTables);
const eightAccountParsed = parseCreditReport('', undefined, createEightNonRevolvingAccountsDoc());

assert.equal(eightAccountTables.length, 8);
assert.equal(eightAccountTables.some((table) => table.fragmentCount && table.fragmentCount > 1), false);
assert.equal(eightAccountClassified.creditAccount.length, 8);
assert.equal(eightAccountParsed.report.creditDetail.nonRevolvingLoans.length, 8);
assert.equal(eightAccountParsed.report.accountDerived.nonRevolvingLoan?.accountCount, 8);

const categoryBoundaryParsed = parseCreditReport('', undefined, createCategoryPositionBoundaryDoc());
assert.equal(categoryBoundaryParsed.report.creditDetail.nonRevolvingLoans.length, 1);
assert.equal(categoryBoundaryParsed.report.creditDetail.revolvingLoansType1.length, 1);
assert.equal(categoryBoundaryParsed.report.creditDetail.revolvingLoansType1[0].org, '循环一测试银行');

const continuationParsed = parseCreditReport('', undefined, createAccountContinuationOutsideClassifierDoc());
assert.equal(continuationParsed.report.creditDetail.nonRevolvingLoans.length, 1);
assert.equal(continuationParsed.report.creditDetail.nonRevolvingLoans[0].monthlyPayment, 706);

const rev1SplitParsed = parseCreditReport('', undefined, createRevolvingLoan1SplitWithoutNewAnchorDoc());
assert.equal(rev1SplitParsed.report.creditDetail.revolvingLoansType1.length, 1);
assert.equal(rev1SplitParsed.report.creditDetail.revolvingLoansType1[0].loanAmount, 40000);
assert.equal(rev1SplitParsed.report.creditDetail.revolvingLoansType1[0].monthlyPayment, 800);

const repeatedAnchorParsed = parseCreditReport('', undefined, createRepeatedAnchorSeparateAccountsDoc());
assert.equal(repeatedAnchorParsed.report.creditDetail.nonRevolvingLoans.length, 2);
assert.deepEqual(
  repeatedAnchorParsed.report.creditDetail.nonRevolvingLoans.map((account) => account.org),
  ['北京中关村银行股份有限公司', '威海银行股份有限公司'],
);

const manyCardsParsed = parseCreditReport('', undefined, createManyCreditCardsWithDamagedAnchorsDoc());
assert.equal(manyCardsParsed.report.creditDetail.creditCards.length, 11);
assert.equal(manyCardsParsed.report.creditDetail.creditCards[1].org, '另一发卡银行股份有限公司');
assert.equal(manyCardsParsed.report.creditDetail.creditCards[10].org, '同一发卡银行股份有限公司');

const headerlessCardParsed = parseCreditReport('', undefined, createHeaderlessCreditCardValueDoc());
const headerlessCard = headerlessCardParsed.report.creditDetail.creditCards[0];
assert.equal(headerlessCardParsed.report.creditDetail.creditCards.length, 1);
assert.equal(headerlessCard.org, '中国建设银 开发分');
assert.equal(headerlessCard.creditLimit, 15000);
assert.equal(headerlessCard.status, '正常');

const mixedCardStatusParsed = parseCreditReport('', undefined, createMixedCreditCardStatusDoc());
assert.equal(mixedCardStatusParsed.report.creditDetail.creditCards.length, 2);
assert.deepEqual(
  mixedCardStatusParsed.report.creditDetail.creditCards.map((account) => account.status),
  ['正常', '销户'],
);
assert.equal(mixedCardStatusParsed.report.creditDetail.creditCards[1].usedAmount, null);
assert.equal(mixedCardStatusParsed.report.accountDerived.creditCard?.accountCount, 2);
assert.equal(mixedCardStatusParsed.report.accountDerived.creditCard?.totalCredit, 50000);
assert.equal(mixedCardStatusParsed.report.accountDerived.creditCard?.balance, 12000);
assert.equal(mixedCardStatusParsed.report.accountDerived.creditCard?.monthlyPayment, 1200);

const splitCardLimitParsed = parseCreditReport('', undefined, createSplitCreditCardLimitDoc());
assert.equal(splitCardLimitParsed.report.creditDetail.creditCards.length, 1);
assert.equal(splitCardLimitParsed.report.creditDetail.creditCards[0].org, '中国光大银行股份有限公司');
assert.equal(splitCardLimitParsed.report.creditDetail.creditCards[0].creditLimit, 50000);
assert.equal(splitCardLimitParsed.report.creditDetail.creditCards[0].usedAmount, 12000);

const inactiveAndForeignCardParsed = parseCreditReport('', undefined, {
  file_name: 'inactive-foreign-card.pdf',
  file_id: 'inactive-foreign-card',
  pages: [{
    page_id: 'page-1',
    page_num: 0,
    text: '三 信贷交易信息明细\n（四）贷记卡账户\n账户1\n账户2\n四 查询记录',
    layouts: [
      textLayout('l-credit-detail-inactive-foreign', '三 信贷交易信息明细', 80),
      textLayout('l-card-inactive-foreign', '（四）贷记卡账户', 110),
      textLayout('l-account-inactive', '账户1', 140),
      tableLayout('t-card-inactive', 170),
      textLayout('l-account-foreign', '账户2', 250),
      tableLayout('t-card-foreign', 280),
      textLayout('l-query-inactive-foreign', '四 查询记录', 380),
    ],
    tables: [
      docTable('t-card-inactive', createCreditCardTable('未激活银行股份有限公司', 'B10411C0003', '30,000', '未激活', '8,000', '800'), 170),
      docTable('t-card-foreign', createCreditCardTable('外币银行股份有限公司', 'B10411C0004', '40,000', '正常', '9,000', '900', '美元'), 280),
    ],
    images: [],
    meta: {
      page_width: 842,
      page_height: 1191,
      is_scan: true,
      page_angle: 0,
      page_type: 'normal',
    },
  }],
});
assert.deepEqual(
  inactiveAndForeignCardParsed.report.creditDetail.creditCards.map((account) => account.status),
  ['其他', '其他币种'],
);
assert.equal(inactiveAndForeignCardParsed.report.accountDerived.creditCard?.totalCredit, 0);
assert.equal(inactiveAndForeignCardParsed.report.accountDerived.creditCard?.balance, 0);
assert.equal(inactiveAndForeignCardParsed.report.accountDerived.creditCard?.monthlyPayment, 0);

const parsed = parseCreditReport(fullText, undefined, createFixtureDoc());
const repay = parsed.report.repayResponsibilities[0];

assert.equal(parsed.report.repayResponsibilities.length, 1);
assert.equal(repay.org, '测试银行股份有限公司');
assert.equal(repay.businessType, '个人住房贷款');
assert.equal(repay.openDate, '2025.01.01');
assert.equal(repay.endDate, '2035.01.01');
assert.equal(repay.responsibilityType, '保证人');
assert.equal(repay.responsibilityAmount, 100000);
assert.equal(repay.currency, '人民币');
assert.equal(repay.contractNo, 'HT001');
assert.equal(repay.borrowerName, '张三');
assert.equal(repay.borrowerCertType, '身份证');
assert.equal(repay.borrowerCertNo, '110101199001011234');
assert.equal(repay.balance, 80000);
assert.equal(parsed.report.queryRecord.orgQueries.length, 1);

const combinedParsed = parseCreditReport(fullText, undefined, createCombinedRepayFixtureDoc());
const combinedRepay = combinedParsed.report.repayResponsibilities[0];

assert.equal(combinedParsed.report.repayResponsibilities.length, 1);
assert.equal(combinedRepay.org, '测试银行股份有限公司');
assert.equal(combinedRepay.businessType, '个人住房贷款');
assert.equal(combinedRepay.responsibilityType, '保证人');
assert.equal(combinedRepay.responsibilityAmount, 100000);
assert.equal(combinedRepay.borrowerName, '张三');
assert.equal(combinedRepay.balance, 80000);

const quality = evaluateOcrQuality(createCombinedRepayFixtureDoc());
assert.equal(quality.pages, 1);
assert.equal(quality.tables.count, 2);
assert.equal(quality.anchors.counts['个人信用报告'], 1);
assert.equal(quality.profile, 'pboc-personal-fragment');
assert.equal(quality.scope.type, 'fragment');
assert.ok(quality.scope.recognizedModules.some((item) => item.key === 'repayResponsibility'));
assert.equal(quality.issues.some((issue) => issue.includes('关键锚点')), false);

const monthlyDocTables = extractTablesFromDoc(createMonthlyFixtureDoc());
const monthlyClassified = classifyTables(monthlyDocTables);
const monthlySummary = computeSummaryFromAccounts([], [], undefined, monthlyClassified.creditAccount);
const monthlyParsed = parseCreditReport('', undefined, createMonthlyFixtureDoc());

assert.equal(monthlySummary.nonRevolvingLoan.monthlyPayment, 706);
assert.equal(monthlySummary.nonRevolvingLoan.balance, 11576);
assert.equal(monthlyParsed.report.accountBriefs[0].monthlyPayment, 706);
assert.equal(monthlyParsed.report.accountBriefs[0].balance, 11576);
assert.equal(monthlyParsed.profile.monthlyRepayment, 706);

const bareMonthlyTables = extractTablesFromDoc(createBareMonthlyFragmentDoc());
const bareMonthlyClassified = classifyTables(bareMonthlyTables);
const bareMonthlySummary = computeSummaryFromAccounts([], [], undefined, bareMonthlyClassified.creditAccount);
const bareMonthlyParsed = parseCreditReport('', undefined, createBareMonthlyFragmentDoc());

assert.equal(bareMonthlyClassified.creditAccount.length, 1);
assert.equal(bareMonthlySummary.nonRevolvingLoan.monthlyPayment, 706);
assert.equal(bareMonthlySummary.nonRevolvingLoan.balance, 11576);
assert.equal(bareMonthlyParsed.report.accountBriefs[0].monthlyPayment, 706);
assert.equal(bareMonthlyParsed.profile.monthlyRepayment, 706);

const repairedBalanceParsed = parseCreditReport('', undefined, createSummaryBalanceRepairDoc());
const repairedBalanceLoan = repairedBalanceParsed.report.creditDetail.nonRevolvingLoans[0];

assert.equal(repairedBalanceParsed.report.creditDetail.nonRevolvingLoans.length, 1);
assert.equal(repairedBalanceLoan.balance, 7871);
assert.equal(repairedBalanceLoan.monthlyPayment, 2713);
assert.equal(repairedBalanceParsed.report.accountDerived.nonRevolvingLoan?.balance, 7871);
assert.equal(
  repairedBalanceParsed.report.accountBriefs.find((brief) => brief.org === '测试银行')?.balance,
  7871,
);

const cardMonthlyParsed = parseCreditReport('', undefined, createCreditCardMonthlyFixtureDoc());
const cardMonthly = cardMonthlyParsed.report.creditDetail.creditCards[0];

assert.equal(cardMonthly.monthlyPayment, 1200);
assert.equal(cardMonthly.usedAmount, 12000);
assert.equal(cardMonthly.billDate, '2026.05.16');
assert.equal(cardMonthlyParsed.report.accountBriefs[0].monthlyPayment, 1200);
assert.equal(cardMonthlyParsed.profile.monthlyRepayment, 1200);

const bareQueryParsed = parseCreditReport('', undefined, createBareQueryFragmentDoc());
const bareQueryQuality = evaluateOcrQuality(createBareQueryFragmentDoc());

assert.equal(bareQueryParsed.report.queryRecord.orgQueries.length, 1);
assert.equal(bareQueryQuality.scope.type, 'fragment');
assert.ok(bareQueryQuality.scope.recognizedModules.some((item) => item.key === 'queryRecord'));
