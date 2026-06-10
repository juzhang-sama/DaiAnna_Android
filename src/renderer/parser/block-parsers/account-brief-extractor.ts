/**
 * 从 DocParser 表格提取每个账户的简要信息 — 用于账户明细 Tab 展示
 *
 * 使用精确分类替代关键词匹配，避免子串交叉污染
 */

import type { AccountBrief } from '../../types/credit-report';
import type { ContextTable } from '../doc-table-bridge';
import { groupAccountTables, isAccountSummaryTable, type AccountCategory } from '../doc-table-bridge';
import { findTableValueByLabels } from './loan-table-utils';
import { isActiveCreditCardStatus, normalizeCreditCardStatus } from '../../utils/credit-card-status';

/** 类别中文标签映射 */
const CATEGORY_LABELS: Record<AccountCategory, string> = {
  nonRevolvingLoan: '非循环贷账户',
  revolvingLoan1: '循环贷账户一',
  revolvingLoan2: '循环贷账户二',
  creditCard: '贷记卡账户',
  repayResponsibility: '相关还款责任信息',
  creditAgreement: '授信协议信息',
};

/** 从所有 DocParser 表格提取账户简要列表 */
export function extractAccountBriefs(docTables: ContextTable[]): AccountBrief[] {
  if (!docTables?.length) return [];

  const briefs: AccountBrief[] = [];
  const groups = groupAccountTables(docTables);

  for (const category of Object.keys(groups) as AccountCategory[]) {
    const tables = groups[category];
    const isCard = category === 'creditCard';
    const label = CATEGORY_LABELS[category];

    for (const ct of tables) {
      if (isAccountSummaryTable(ct)) continue;
      briefs.push(extractBriefFromTable(ct, category, label, isCard));
    }
  }

  return briefs;
}

/** 从单个 DocParser 表格提取一条账户简要 */
function extractBriefFromTable(
  ct: ContextTable, category: string, categoryLabel: string, isCreditCard: boolean,
): AccountBrief {
  const t = ct.table;

  const org = findTableValueByLabels(t, isCreditCard ? '发卡机构' : '管理机构');
  const openDate = findTableValueByLabels(t, '开立日期', 'date');
  const currency = isCreditCard ? findTableValueByLabels(t, '币种') : '';
  const rawStatus = findTableValueByLabels(t, '账户状态');
  const status = isCreditCard ? normalizeCreditCardStatus(rawStatus, currency) : rawStatus;
  const isClosed = isCreditCard ? !isActiveCreditCardStatus(status) : /结清|销户/.test(status);

  const creditLabel = isCreditCard ? '授信额度' : '借款金额';
  const balanceLabel = isCreditCard ? '已用额度' : '余额';

  const creditAmount = parseDocNum(findTableValueByLabels(t, creditLabel, 'amount'));
  const balance = parseDocNum(findTableValueByLabels(t, balanceLabel, 'amount'));
  const monthlyPayment = isClosed ? 0 : parseDocNum(
    findTableValueByLabels(t, ['本月应还款', '本月应还', '应还款额', '本期应还'], 'amount'),
  );

  return {
    category, categoryLabel, org, openDate,
    creditAmount, balance, monthlyPayment, status, isClosed,
  };
}

/** 解析文档解析返回的数值字符串 */
function parseDocNum(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.trim()
    .replace(/,/g, '')
    .replace(/--/g, '0')
    .replace(/\.(\d{3})(?!\d)/g, '$1');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
