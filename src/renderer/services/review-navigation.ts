export type ReviewDestinationTab = 'quality' | 'personal' | 'credit' | 'query' | 'provenance';

export type CreditReviewSectionKey =
  | 'summary'
  | 'nonRevolvingLoan'
  | 'revolvingLoan1'
  | 'revolvingLoan2'
  | 'creditCard'
  | 'repayResponsibility'
  | 'creditAgreement';

export interface ReviewNavigationTarget {
  field: string;
  normalizedField: string;
  destinationTab: ReviewDestinationTab;
  creditSectionKey?: CreditReviewSectionKey;
  querySectionKey?: 'orgQuery' | 'selfQuery';
  anchorField: string;
  anchorId: string;
  rowIndex?: number;
  fieldName?: string;
  label: string;
  focusToken: number;
}

const ACCOUNT_LIST_TO_SECTION: Record<string, CreditReviewSectionKey> = {
  nonRevolvingLoans: 'nonRevolvingLoan',
  revolvingLoansType1: 'revolvingLoan1',
  revolvingLoansType2: 'revolvingLoan2',
  creditCards: 'creditCard',
  repayResponsibilities: 'repayResponsibility',
  creditAgreements: 'creditAgreement',
};

const ACCOUNT_DERIVED_SECTION: Record<string, CreditReviewSectionKey> = {
  nonRevolvingLoan: 'summary',
  revolvingLoan1: 'summary',
  revolvingLoan2: 'summary',
  creditCard: 'summary',
};

const ACCOUNT_FIELD_RE = /^(?:creditDetail\.)?([A-Za-z0-9]+)\[(\d+)\]\.([A-Za-z0-9]+)$/;
const ACCOUNT_DERIVED_FIELD_RE = /^accountDerived\.([A-Za-z0-9]+)\.([A-Za-z0-9]+)$/;

export function buildReviewNavigationTarget(field: string): ReviewNavigationTarget {
  const normalizedField = normalizeReviewField(field);
  const accountMatch = normalizedField.match(ACCOUNT_FIELD_RE);
  const accountDerivedMatch = normalizedField.match(ACCOUNT_DERIVED_FIELD_RE);
  let destinationTab: ReviewDestinationTab = 'quality';
  let creditSectionKey: CreditReviewSectionKey | undefined;
  let querySectionKey: ReviewNavigationTarget['querySectionKey'];
  let rowIndex: number | undefined;
  let fieldName: string | undefined;
  let label = normalizedField;

  if (normalizedField.startsWith('header.') || normalizedField.startsWith('personalInfo.')) {
    destinationTab = 'personal';
    fieldName = getLastPathSegment(normalizedField);
    label = fieldName ? getFieldLabel(fieldName) : normalizedField;
  } else if (accountMatch) {
    const [, listName, rowIndexText, accountFieldName] = accountMatch;
    destinationTab = 'credit';
    creditSectionKey = ACCOUNT_LIST_TO_SECTION[listName] ?? 'nonRevolvingLoan';
    rowIndex = Number(rowIndexText);
    fieldName = accountFieldName;
    label = `${getCreditSectionLabel(creditSectionKey)}第 ${rowIndex + 1} 笔 ${getFieldLabel(fieldName)}`;
  } else if (accountDerivedMatch) {
    const [, summaryKey, summaryFieldName] = accountDerivedMatch;
    destinationTab = 'credit';
    creditSectionKey = ACCOUNT_DERIVED_SECTION[summaryKey] ?? 'summary';
    fieldName = summaryFieldName;
    label = `${getAccountDerivedLabel(summaryKey)} ${getFieldLabel(fieldName)}`;
  } else if (normalizedField.startsWith('queryRecord.selfQueries')) {
    destinationTab = 'query';
    querySectionKey = 'selfQuery';
    fieldName = getLastPathSegment(normalizedField);
    label = fieldName ? `本人查询 ${getFieldLabel(fieldName)}` : '本人查询记录';
  } else if (normalizedField.startsWith('queryRecord.orgQueries') || normalizedField === 'queryRecord') {
    destinationTab = 'query';
    querySectionKey = 'orgQuery';
    fieldName = getLastPathSegment(normalizedField);
    label = fieldName ? `机构查询 ${getFieldLabel(fieldName)}` : '查询记录';
  }

  return {
    field,
    normalizedField,
    destinationTab,
    creditSectionKey,
    querySectionKey,
    anchorField: normalizedField,
    anchorId: buildReviewFieldDomId(normalizedField),
    rowIndex,
    fieldName,
    label,
    focusToken: Date.now(),
  };
}

export function normalizeReviewField(field: string): string {
  return field.trim().replace(/^creditDetail\./, '');
}

export function buildReviewFieldDomId(field: string): string {
  return `review-field-${normalizeReviewField(field).replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

export function getCreditSectionKeyForField(field: string): CreditReviewSectionKey | undefined {
  return buildReviewNavigationTarget(field).creditSectionKey;
}

function getCreditSectionLabel(sectionKey: CreditReviewSectionKey): string {
  const labels: Record<CreditReviewSectionKey, string> = {
    summary: '账户汇总',
    nonRevolvingLoan: '非循环贷账户',
    revolvingLoan1: '循环贷账户一',
    revolvingLoan2: '循环贷账户二',
    creditCard: '贷记卡账户',
    repayResponsibility: '相关还款责任',
    creditAgreement: '授信协议信息',
  };
  return labels[sectionKey];
}

function getAccountDerivedLabel(summaryKey: string): string {
  const labels: Record<string, string> = {
    nonRevolvingLoan: '非循环贷汇总',
    revolvingLoan1: '循环贷一汇总',
    revolvingLoan2: '循环贷二汇总',
    creditCard: '贷记卡汇总',
  };
  return labels[summaryKey] ?? '账户汇总';
}

function getLastPathSegment(field: string): string | undefined {
  const parts = field.split('.');
  return parts[parts.length - 1];
}

function getFieldLabel(fieldName: string): string {
  const labels: Record<string, string> = {
    name: '姓名',
    reportNo: '报告编号',
    reportTime: '报告时间',
    certNo: '证件号码',
    org: '机构',
    loanAmount: '借款金额',
    creditLimit: '授信额度',
    usedAmount: '已用额度',
    balance: '余额',
    monthlyPayment: '本月应还',
    accountCount: '账户数',
    totalCredit: '授信/借款总额',
    status: '账户状态',
    queryDate: '查询日期',
    queryOrg: '查询机构',
    queryReason: '查询原因',
  };
  return labels[fieldName] ?? fieldName;
}
