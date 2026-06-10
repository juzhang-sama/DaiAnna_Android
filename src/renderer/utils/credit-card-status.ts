export type CreditCardAccountStatus = '正常' | '销户' | '其他币种' | '其他';

export const CREDIT_CARD_STATUS_OPTIONS: CreditCardAccountStatus[] = ['正常', '销户', '其他币种', '其他'];

const CLOSED_CREDIT_CARD_STATUS_RE = /销户|结清|提前结清|关闭|注销|作废|停用/;
const NORMAL_CREDIT_CARD_STATUS_RE = /正常/;
const RMB_CURRENCY_RE = /^(?:人民币|人民币元|CNY|RMB|156|元)?$/i;

export function normalizeCreditCardStatus(status: string, currency = ''): CreditCardAccountStatus {
  const normalizedCurrency = currency.replace(/\s+/g, '');
  if (normalizedCurrency && !RMB_CURRENCY_RE.test(normalizedCurrency)) return '其他币种';

  const normalized = status.replace(/\s+/g, '');
  if (CLOSED_CREDIT_CARD_STATUS_RE.test(normalized)) return '销户';
  if (NORMAL_CREDIT_CARD_STATUS_RE.test(normalized)) return '正常';
  return '其他';
}

export function isActiveCreditCardStatus(status: string, currency = ''): boolean {
  return normalizeCreditCardStatus(status, currency) === '正常';
}

export function isClosedCreditCardStatus(status: string): boolean {
  return normalizeCreditCardStatus(status) === '销户';
}
