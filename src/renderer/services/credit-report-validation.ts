import type {
  CreditCardAccount,
  CreditReport,
  LoanAccount,
  RevolvingLoanAccount,
} from '../types/credit-report';
import type {
  CreditReportValidationIssue,
  CreditReportValidationReport,
  DiagnosticSeverity,
} from '../types/ocr-diagnostics';
import { isActiveCreditCardStatus, isClosedCreditCardStatus } from '../utils/credit-card-status';

type IssueInput = Omit<CreditReportValidationIssue, 'id'>;

export function validateCreditReportData(report: CreditReport): CreditReportValidationReport {
  const issues: CreditReportValidationIssue[] = [];
  const push = (issue: IssueInput) => {
    issues.push({ ...issue, id: `${issue.category}:${issue.field}:${issues.length + 1}` });
  };

  validateHeader(report, push);
  validateLoanAccounts('非循环贷账户', 'nonRevolvingLoans', report.creditDetail.nonRevolvingLoans, push);
  validateLoanAccounts('循环贷账户一', 'revolvingLoansType1', report.creditDetail.revolvingLoansType1, push);
  validateRevolvingLoan2(report.creditDetail.revolvingLoansType2, push);
  validateCreditCards(report.creditDetail.creditCards, push);
  validateAccountCounts(report, push);
  validateQueryRecords(report, push);

  const summary = {
    critical: issues.filter((issue) => issue.severity === 'critical').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  };
  const score = Math.max(0, Math.min(1, round(
    1 - summary.critical * 0.16 - summary.warning * 0.055 - summary.info * 0.015,
  )));

  return {
    score,
    requiresReview: summary.critical > 0 || summary.warning >= 3,
    summary,
    issues,
  };
}

function validateHeader(report: CreditReport, push: (issue: IssueInput) => void): void {
  if (!report.header.name) {
    push(issue('warning', '报告头', 'header.name', '客户姓名未识别', '请核对报告首页姓名字段。'));
  }
  if (!report.header.reportNo) {
    push(issue('warning', '报告头', 'header.reportNo', '报告编号未识别', '请核对报告首页报告编号。'));
  }
  if (!report.header.reportTime) {
    push(issue('warning', '报告头', 'header.reportTime', '报告时间未识别', '请核对报告首页报告时间。'));
  }
}

function validateLoanAccounts(
  label: string,
  fieldPrefix: string,
  accounts: LoanAccount[],
  push: (issue: IssueInput) => void,
): void {
  accounts.forEach((account, index) => {
    const active = !isClosed(account.status);
    const prefix = `${fieldPrefix}[${index}]`;
    if (!account.org) {
      push(issue('warning', label, `${prefix}.org`, `${label}第${index + 1}笔机构未识别`, '请对照原文核对管理机构。'));
    }
    if (account.loanAmount <= 0 && active) {
      push(issue('warning', label, `${prefix}.loanAmount`, `${account.org || label}借款金额为空或为0`, '请核对借款金额是否漏识别。'));
    }
    if (active && account.balance !== null && account.loanAmount > 0 && account.balance > account.loanAmount * 1.05) {
      push(issue('critical', label, `${prefix}.balance`, `${account.org || label}余额大于借款金额`, '余额通常不应超过借款金额，请优先核对金额列是否错位。'));
    }
    if (active && zeroish(account.monthlyPayment) && (account.balance ?? 0) > 0) {
      push(issue('warning', label, `${prefix}.monthlyPayment`, `${account.org || label}有余额但本月应还为0`, '请核对“本月应还款”字段是否漏识别。'));
    }
    if (active && (account.monthlyPayment ?? 0) > 0 && (account.balance ?? 0) > 0 && (account.monthlyPayment ?? 0) > (account.balance ?? 0) * 1.2) {
      push(issue('critical', label, `${prefix}.monthlyPayment`, `${account.org || label}本月应还异常高`, '本月应还超过余额，疑似小数点、千分位或列错位。'));
    }
    if (isClosed(account.status) && (account.balance ?? 0) > 0) {
      push(issue('warning', label, `${prefix}.balance`, `${account.org || label}已结清账户仍有余额`, '请核对账户状态和余额字段。'));
    }
  });
}

function validateRevolvingLoan2(
  accounts: RevolvingLoanAccount[],
  push: (issue: IssueInput) => void,
): void {
  accounts.forEach((account, index) => {
    const active = !isClosed(account.status);
    const prefix = `revolvingLoansType2[${index}]`;
    if (!account.org) {
      push(issue('warning', '循环贷账户二', `${prefix}.org`, `循环贷账户二第${index + 1}笔机构未识别`, '请对照原文核对管理机构。'));
    }
    if (active && account.balance !== null && account.creditLimit > 0 && account.balance > account.creditLimit * 1.05) {
      push(issue('critical', '循环贷账户二', `${prefix}.balance`, `${account.org || '循环贷账户二'}余额大于授信额度`, '请核对余额和授信额度是否识别错列。'));
    }
    if (active && zeroish(account.monthlyPayment) && (account.balance ?? 0) > 0) {
      push(issue('warning', '循环贷账户二', `${prefix}.monthlyPayment`, `${account.org || '循环贷账户二'}有余额但本月应还为0`, '请核对“本月应还款”字段。'));
    }
    if (active && (account.monthlyPayment ?? 0) > 0 && (account.balance ?? 0) > 0 && (account.monthlyPayment ?? 0) > (account.balance ?? 0) * 1.2) {
      push(issue('critical', '循环贷账户二', `${prefix}.monthlyPayment`, `${account.org || '循环贷账户二'}本月应还异常高`, '本月应还超过余额，疑似小数点、千分位或列错位。'));
    }
  });
}

function validateCreditCards(
  accounts: CreditCardAccount[],
  push: (issue: IssueInput) => void,
): void {
  accounts.forEach((account, index) => {
    const active = isActiveCreditCardStatus(account.status);
    const prefix = `creditCards[${index}]`;
    if (!account.org) {
      push(issue('warning', '贷记卡账户', `${prefix}.org`, `贷记卡第${index + 1}笔发卡机构未识别`, '请对照原文核对发卡机构。'));
    }
    if (account.creditLimit <= 0 && active) {
      push(issue('warning', '贷记卡账户', `${prefix}.creditLimit`, `${account.org || '贷记卡'}授信额度为空或为0`, '请核对账户授信额度。'));
    }
    if (active && account.usedAmount !== null && account.creditLimit > 0 && account.usedAmount > account.creditLimit * 1.15) {
      push(issue('critical', '贷记卡账户', `${prefix}.usedAmount`, `${account.org || '贷记卡'}已用额度大于授信额度`, '请优先核对已用额度和授信额度，可能存在列错位或多读数字。'));
    }
    if (isClosedCreditCardStatus(account.status) && (account.usedAmount ?? 0) > 0) {
      push(issue('warning', '贷记卡账户', `${prefix}.usedAmount`, `${account.org || '贷记卡'}非正常账户仍有已用额度`, '请核对账户状态和已用额度。'));
    }
  });
}

function validateAccountCounts(report: CreditReport, push: (issue: IssueInput) => void): void {
  compareCount('非循环贷账户', 'accountDerived.nonRevolvingLoan.accountCount', report.accountDerived.nonRevolvingLoan?.accountCount, report.creditDetail.nonRevolvingLoans.length, push);
  compareCount('循环贷账户一', 'accountDerived.revolvingLoan1.accountCount', report.accountDerived.revolvingLoan1?.accountCount, report.creditDetail.revolvingLoansType1.length, push);
  compareCount('循环贷账户二', 'accountDerived.revolvingLoan2.accountCount', report.accountDerived.revolvingLoan2?.accountCount, report.creditDetail.revolvingLoansType2.length, push);
  compareCount('贷记卡账户', 'accountDerived.creditCard.accountCount', report.accountDerived.creditCard?.accountCount, report.creditDetail.creditCards.length, push);
}

function compareCount(
  label: string,
  field: string,
  expected: number | undefined,
  actual: number,
  push: (issue: IssueInput) => void,
): void {
  if (expected === undefined || expected === actual) return;
  push(issue(
    'warning',
    '账户数量',
    field,
    `${label}数量不一致：章节识别 ${expected} 笔，明细解析 ${actual} 笔`,
    '请核对该章节是否有跨页续表、漏页或误分类表格。',
  ));
}

function validateQueryRecords(report: CreditReport, push: (issue: IssueInput) => void): void {
  const total = report.queryRecord.orgQueries.length + report.queryRecord.selfQueries.length;
  if (total === 0) {
    push(issue('info', '查询记录', 'queryRecord', '未识别到查询记录明细', '若原报告存在查询记录，请核对查询记录页。'));
  }
}

function issue(
  severity: DiagnosticSeverity,
  category: string,
  field: string,
  message: string,
  suggestion: string,
): IssueInput {
  return {
    severity,
    category,
    field,
    label: field,
    message,
    suggestion,
  };
}

function isClosed(status: string): boolean {
  return /结清|销户|未激活/.test(status);
}

function zeroish(value: number | null): boolean {
  return value === null || value === 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
