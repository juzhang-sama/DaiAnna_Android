import type {
  CreditCardAccount,
  CreditReport,
  LoanAccount,
  RevolvingLoanAccount,
} from '../types/credit-report';
import { isActiveCreditCardStatus } from '../utils/credit-card-status';

export type DebtCategory = 'mortgage' | 'business' | 'consumer' | 'auto' | 'other' | 'creditCard';

export interface DebtBreakdownItem {
  key: DebtCategory;
  label: string;
  count: number;
  balance: number;
  monthlyPayment: number;
  balanceShare: number | null;
  paymentShare: number | null;
  paymentRate: number | null;
}

export interface InstallmentCardItem {
  key: string;
  org: string;
  creditLimit: number;
  usedAmount: number;
  availableLimit: number;
  monthlyPayment: number;
  usageRate: number | null;
  status: string;
  reason: string;
}

export type PlanImpactLevel = '低' | '中' | '高' | '极高';
export type InsightLevel = '正常' | '关注' | '预警' | '高风险';

export interface DebtPressureMetrics {
  monthlyPaymentRate: number | null;
  cardUsageRate: number | null;
  nonMortgageDebtShare: number | null;
  businessDebtShare: number | null;
  mortgagePayment: number;
  nonMortgagePayment: number;
  overdueAccountCount: number;
}

export interface AnalysisInsight {
  key: string;
  title: string;
  level: InsightLevel;
  description: string;
  evidence: string[];
  suggestion: string;
}

export interface PlanCalculationLine {
  label: string;
  amount: number;
  explanation: string;
}

export interface PaymentReductionPlan {
  key: string;
  name: string;
  impactLevel: PlanImpactLevel;
  originalMonthlyPayment: number;
  targetMonthlyPayment: number;
  releasedCashFlow: number;
  basis: string;
  calculations: PlanCalculationLine[];
  advantages: string[];
  risks: string[];
  complianceNote: string;
}

export interface DebtAnalysisReport {
  generatedAt: string;
  customerName: string;
  reportNo: string;
  reportTime: string;
  debtTotal: number;
  debtCount: number;
  activeLoanCount: number;
  activeCardCount: number;
  totalLoanBalance: number;
  totalCardUsed: number;
  totalCardLimit: number;
  originalMonthlyPayment: number;
  metrics: DebtPressureMetrics;
  insights: AnalysisInsight[];
  debtBreakdown: DebtBreakdownItem[];
  installmentCards: InstallmentCardItem[];
  plans: PaymentReductionPlan[];
  summary: string[];
  riskNotes: string[];
}

type LoanLike = LoanAccount | RevolvingLoanAccount;

const CLOSED_STATUS_RE = /结清|销户|未激活|关闭|注销/;
const NORMAL_STATUS_RE = /正常|尚未逾期|未逾期/;

const CATEGORY_LABELS: Record<DebtCategory, string> = {
  mortgage: '房贷',
  business: '经营贷',
  consumer: '消费贷',
  auto: '车贷',
  other: '其他贷款',
  creditCard: '信用卡已用额度',
};

const CATEGORY_ORDER: DebtCategory[] = ['mortgage', 'business', 'consumer', 'auto', 'other', 'creditCard'];

const INSTALLMENT_CARD_BANKS = ['广发', '招商', '招行', '民生', '广州', '平安', '光大', '华夏'];
const NON_MORTGAGE_CATEGORIES: DebtCategory[] = ['business', 'consumer', 'auto', 'other', 'creditCard'];

export function buildDebtAnalysisReport(report: CreditReport): DebtAnalysisReport {
  const buckets = createEmptyBuckets();
  const installmentCards: InstallmentCardItem[] = [];

  const loanAccounts: LoanLike[] = [
    ...report.creditDetail.nonRevolvingLoans,
    ...report.creditDetail.revolvingLoansType1,
    ...report.creditDetail.revolvingLoansType2,
  ];

  for (const loan of loanAccounts) {
    if (!isActiveDebt(loan.status, loan.balance, loan.monthlyPayment)) continue;
    const category = classifyLoan(loan.businessType);
    addToBucket(buckets[category], loan.balance ?? 0, loan.monthlyPayment ?? 0);
  }

  const detailLoanTotal = sumBuckets(buckets, ['mortgage', 'business', 'consumer', 'auto', 'other']);
  const derivedLoanTotal = sumDerivedLoan(report);
  if (detailLoanTotal.balance === 0 && derivedLoanTotal.balance > 0) {
    buckets.other.count = derivedLoanTotal.count;
    buckets.other.balance = derivedLoanTotal.balance;
    buckets.other.monthlyPayment = derivedLoanTotal.monthlyPayment;
  }

  for (const card of report.creditDetail.creditCards) {
    const usedAmount = card.usedAmount ?? card.balance ?? 0;
    if (!isActiveCreditCardDebt(card, usedAmount)) continue;
    addToBucket(buckets.creditCard, usedAmount, card.monthlyPayment ?? 0);
    installmentCards.push(buildInstallmentCard(card, installmentCards.length));
  }

  if (
    report.creditDetail.creditCards.length === 0
    && buckets.creditCard.balance === 0
    && report.accountDerived.creditCard?.balance
  ) {
    const derivedCard = report.accountDerived.creditCard;
    buckets.creditCard.count = derivedCard.accountCount;
    buckets.creditCard.balance = derivedCard.balance;
    buckets.creditCard.monthlyPayment = derivedCard.monthlyPayment;
  }

  const rawDebtBreakdown = CATEGORY_ORDER
    .map((key) => buckets[key])
    .filter((item) => item.count > 0 || item.balance > 0 || item.monthlyPayment > 0);

  const activeLoanCount = sumBuckets(buckets, ['mortgage', 'business', 'consumer', 'auto', 'other']).count;
  const activeCardCount = buckets.creditCard.count;
  const totalLoanBalance = sumBuckets(buckets, ['mortgage', 'business', 'consumer', 'auto', 'other']).balance;
  const totalCardUsed = buckets.creditCard.balance;
  const debtTotal = totalLoanBalance + totalCardUsed;
  const debtCount = activeLoanCount + activeCardCount;
  const totalCardLimit = calcTotalCardLimit(report.creditDetail.creditCards);
  const originalMonthlyPayment = calcOriginalMonthlyPayment(report, rawDebtBreakdown);
  const debtBreakdown = enrichDebtBreakdown(rawDebtBreakdown, debtTotal, originalMonthlyPayment);
  const metrics = buildMetrics(debtBreakdown, debtTotal, totalCardUsed, totalCardLimit, originalMonthlyPayment, report);
  const insights = buildInsights(debtBreakdown, metrics, installmentCards);

  return {
    generatedAt: new Date().toISOString(),
    customerName: report.header.name,
    reportNo: report.header.reportNo,
    reportTime: report.header.reportTime,
    debtTotal,
    debtCount,
    activeLoanCount,
    activeCardCount,
    totalLoanBalance,
    totalCardUsed,
    totalCardLimit,
    originalMonthlyPayment,
    metrics,
    insights,
    debtBreakdown,
    installmentCards,
    plans: buildPlans(originalMonthlyPayment, debtBreakdown, installmentCards),
    summary: buildSummary(debtTotal, activeLoanCount, activeCardCount, originalMonthlyPayment, debtBreakdown, metrics),
    riskNotes: buildRiskNotes(report, originalMonthlyPayment),
  };
}

function createEmptyBuckets(): Record<DebtCategory, DebtBreakdownItem> {
  return CATEGORY_ORDER.reduce((acc, key) => {
    acc[key] = {
      key,
      label: CATEGORY_LABELS[key],
      count: 0,
      balance: 0,
      monthlyPayment: 0,
      balanceShare: null,
      paymentShare: null,
      paymentRate: null,
    };
    return acc;
  }, {} as Record<DebtCategory, DebtBreakdownItem>);
}

function addToBucket(bucket: DebtBreakdownItem, balance: number, monthlyPayment: number): void {
  bucket.count += 1;
  bucket.balance += sanitizeAmount(balance);
  bucket.monthlyPayment += sanitizeAmount(monthlyPayment);
}

function isActiveDebt(status: string, amount?: number | null, monthlyPayment?: number | null): boolean {
  const debtAmount = sanitizeAmount(amount ?? 0);
  const payment = sanitizeAmount(monthlyPayment ?? 0);
  if (CLOSED_STATUS_RE.test(status)) return false;
  if (debtAmount > 0 || payment > 0) return true;
  return NORMAL_STATUS_RE.test(status);
}

function isActiveCreditCardDebt(
  card: CreditCardAccount,
  usedAmount: number,
): boolean {
  if (!isActiveCreditCardStatus(card.status)) return false;
  return sanitizeAmount(usedAmount) > 0 || sanitizeAmount(card.monthlyPayment ?? 0) > 0;
}

function classifyLoan(businessType: string): DebtCategory {
  if (/住房|房贷|公积金|按揭|个人住房/.test(businessType)) return 'mortgage';
  if (/经营|经营性|小微|商户|企业主/.test(businessType)) return 'business';
  if (/汽车|车贷|购车/.test(businessType)) return 'auto';
  if (/消费|个人消费|装修|教育|旅游|购物/.test(businessType)) return 'consumer';
  return 'other';
}

function buildInstallmentCard(card: CreditCardAccount, index: number): InstallmentCardItem {
  const usedAmount = sanitizeAmount(card.usedAmount ?? card.balance ?? 0);
  const creditLimit = sanitizeAmount(card.creditLimit);
  const availableLimit = Math.max(0, creditLimit - usedAmount);
  const supportedByBank = INSTALLMENT_CARD_BANKS.some((bank) => card.org.includes(bank));
  return {
    key: `${card.org}-${index}`,
    org: card.org || '未知发卡机构',
    creditLimit,
    usedAmount,
    availableLimit,
    monthlyPayment: sanitizeAmount(card.monthlyPayment ?? 0),
    usageRate: creditLimit > 0 ? usedAmount / creditLimit : null,
    status: card.status,
    reason: supportedByBank ? '机构在可重点核查名单内' : '需结合发卡机构政策人工核查',
  };
}

function enrichDebtBreakdown(
  items: DebtBreakdownItem[],
  debtTotal: number,
  originalMonthlyPayment: number,
): DebtBreakdownItem[] {
  return items.map((item) => ({
    ...item,
    balanceShare: debtTotal > 0 ? item.balance / debtTotal : null,
    paymentShare: originalMonthlyPayment > 0 ? item.monthlyPayment / originalMonthlyPayment : null,
    paymentRate: item.balance > 0 ? item.monthlyPayment / item.balance : null,
  }));
}

function buildMetrics(
  breakdown: DebtBreakdownItem[],
  debtTotal: number,
  totalCardUsed: number,
  totalCardLimit: number,
  originalMonthlyPayment: number,
  report: CreditReport,
): DebtPressureMetrics {
  const mortgage = getBucketItem(breakdown, 'mortgage');
  const business = getBucketItem(breakdown, 'business');
  const nonMortgage = breakdown
    .filter((item) => NON_MORTGAGE_CATEGORIES.includes(item.key))
    .reduce((sum, item) => ({
      balance: sum.balance + item.balance,
      monthlyPayment: sum.monthlyPayment + item.monthlyPayment,
    }), { balance: 0, monthlyPayment: 0 });

  return {
    monthlyPaymentRate: debtTotal > 0 ? originalMonthlyPayment / debtTotal : null,
    cardUsageRate: totalCardLimit > 0 ? totalCardUsed / totalCardLimit : null,
    nonMortgageDebtShare: debtTotal > 0 ? nonMortgage.balance / debtTotal : null,
    businessDebtShare: debtTotal > 0 ? business.balance / debtTotal : null,
    mortgagePayment: mortgage.monthlyPayment,
    nonMortgagePayment: nonMortgage.monthlyPayment,
    overdueAccountCount: countCurrentOverdue(report),
  };
}

function buildInsights(
  breakdown: DebtBreakdownItem[],
  metrics: DebtPressureMetrics,
  installmentCards: InstallmentCardItem[],
): AnalysisInsight[] {
  const insights: AnalysisInsight[] = [];
  const leadingDebt = [...breakdown].sort((a, b) => b.balance - a.balance)[0];
  const highestPayment = [...breakdown].sort((a, b) => b.monthlyPayment - a.monthlyPayment)[0];

  if (metrics.overdueAccountCount > 0) {
    insights.push({
      key: 'current-overdue',
      title: '存在当前逾期信号',
      level: '高风险',
      description: '当前账户状态已经出现逾期信息，任何降低月供方案都应先围绕止损、复核账单和正式沟通展开。',
      evidence: [`当前逾期账户数：${metrics.overdueAccountCount} 个`],
      suggestion: '优先核验逾期账户、逾期金额、是否已结清以及征信更新周期，再讨论后续结构调整。',
    });
  }

  if (leadingDebt && (leadingDebt.balanceShare ?? 0) >= 0.45) {
    insights.push({
      key: 'debt-concentration',
      title: `${leadingDebt.label}余额集中度较高`,
      level: (leadingDebt.balanceShare ?? 0) >= 0.65 ? '预警' : '关注',
      description: '余额集中在单一债务类别时，方案的核心不是平均处理全部账户，而是先处理最影响债务结构的类别。',
      evidence: [
        `${leadingDebt.label}余额：${formatAmount(leadingDebt.balance)} 元`,
        `余额占比：${formatPercentValue(leadingDebt.balanceShare)}`,
      ],
      suggestion: `优先核查${leadingDebt.label}的合同利率、剩余期数、还款方式和可调整政策。`,
    });
  }

  if ((metrics.nonMortgageDebtShare ?? 0) >= 0.6) {
    insights.push({
      key: 'non-mortgage-share',
      title: '非房贷债务占比较高',
      level: (metrics.nonMortgageDebtShare ?? 0) >= 0.8 ? '预警' : '关注',
      description: '非房贷通常期限更短、利率和续贷不确定性更强，是降低月供分析里的优先处理对象。',
      evidence: [
        `非房贷余额占比：${formatPercentValue(metrics.nonMortgageDebtShare)}`,
        `非房贷月供：${formatAmount(metrics.nonMortgagePayment)} 元`,
      ],
      suggestion: '优先拆分经营贷、消费贷和信用卡已用额度，分别核验是否具备分期、展期、重组或账期优化空间。',
    });
  }

  if (metrics.cardUsageRate !== null && metrics.cardUsageRate >= 0.75) {
    insights.push({
      key: 'card-usage',
      title: '信用卡使用率偏高',
      level: metrics.cardUsageRate >= 0.9 ? '预警' : '关注',
      description: '信用卡使用率偏高会压缩应急周转空间，也可能影响后续授信判断。',
      evidence: [`信用卡使用率：${formatPercentValue(metrics.cardUsageRate)}`],
      suggestion: '核查可分期额度、账单日、已出账和未出账金额，优先把高息或高月供部分转成可控节奏。',
    });
  }

  if (installmentCards.length === 0) {
    insights.push({
      key: 'card-installment-gap',
      title: '未识别到可直接核查的信用卡分期空间',
      level: '关注',
      description: '当前报告未体现有已用额度的信用卡账户，信用卡分期对降低月供的贡献可能有限。',
      evidence: ['可分期信用卡清单为空'],
      suggestion: '如客户实际有信用卡账单，应补充账单或手机银行截图后再评估分期空间。',
    });
  }

  if (highestPayment && (highestPayment.paymentShare ?? 0) >= 0.45) {
    insights.push({
      key: 'payment-concentration',
      title: `${highestPayment.label}贡献了主要月供`,
      level: '关注',
      description: '月供压力集中时，优先处理该类别比平均处理全部账户更有效。',
      evidence: [
        `${highestPayment.label}月供：${formatAmount(highestPayment.monthlyPayment)} 元`,
        `月供占比：${formatPercentValue(highestPayment.paymentShare)}`,
      ],
      suggestion: `围绕${highestPayment.label}设计第一优先级方案，并把其余账户作为辅助优化。`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      key: 'stable-structure',
      title: '债务结构暂未触发明显压力信号',
      level: '正常',
      description: '当前仅从征信结构看，未发现特别集中的余额、较高信用卡使用率或当前逾期信号。',
      evidence: ['未触发结构集中、信用卡使用率和逾期类预警'],
      suggestion: '后续应结合客户收入、实际利率、还款日和账单流水判断月供承受能力。',
    });
  }

  return insights;
}

function sumBuckets(
  buckets: Record<DebtCategory, DebtBreakdownItem>,
  keys: DebtCategory[],
): Pick<DebtBreakdownItem, 'count' | 'balance' | 'monthlyPayment'> {
  return keys.reduce(
    (acc, key) => {
      acc.count += buckets[key].count;
      acc.balance += buckets[key].balance;
      acc.monthlyPayment += buckets[key].monthlyPayment;
      return acc;
    },
    { count: 0, balance: 0, monthlyPayment: 0 },
  );
}

function sumDerivedLoan(report: CreditReport): Pick<DebtBreakdownItem, 'count' | 'balance' | 'monthlyPayment'> {
  const summaries = [
    report.accountDerived.nonRevolvingLoan,
    report.accountDerived.revolvingLoan1,
    report.accountDerived.revolvingLoan2,
  ];
  return summaries.reduce(
    (acc, item) => {
      if (!item) return acc;
      acc.count += item.accountCount;
      acc.balance += sanitizeAmount(item.balance);
      acc.monthlyPayment += sanitizeAmount(item.monthlyPayment);
      return acc;
    },
    { count: 0, balance: 0, monthlyPayment: 0 },
  );
}

function calcTotalCardLimit(cards: CreditCardAccount[]): number {
  return cards
    .filter((card) => isActiveCreditCardStatus(card.status))
    .reduce((sum, card) => sum + sanitizeAmount(card.creditLimit), 0);
}

function calcOriginalMonthlyPayment(report: CreditReport, breakdown: DebtBreakdownItem[]): number {
  const fromBreakdown = breakdown.reduce((sum, item) => sum + item.monthlyPayment, 0);
  if (fromBreakdown > 0) return Math.round(fromBreakdown);

  const summaries = [
    report.accountDerived.nonRevolvingLoan,
    report.accountDerived.revolvingLoan1,
    report.accountDerived.revolvingLoan2,
  ];
  if (report.creditDetail.creditCards.length === 0) {
    summaries.push(report.accountDerived.creditCard);
  }
  return Math.round(summaries.reduce((sum, item) => sum + sanitizeAmount(item?.monthlyPayment ?? 0), 0));
}

function buildPlans(
  originalMonthlyPayment: number,
  breakdown: DebtBreakdownItem[],
  installmentCards: InstallmentCardItem[],
): PaymentReductionPlan[] {
  const payment = Math.max(0, Math.round(originalMonthlyPayment));
  const mortgage = getBucketItem(breakdown, 'mortgage');
  const business = getBucketItem(breakdown, 'business');
  const consumer = getBucketItem(breakdown, 'consumer');
  const auto = getBucketItem(breakdown, 'auto');
  const other = getBucketItem(breakdown, 'other');
  const card = getBucketItem(breakdown, 'creditCard');
  const cardInstallmentRelief = calcCardInstallmentRelief(installmentCards);
  const nonMortgagePayment = business.monthlyPayment + consumer.monthlyPayment + auto.monthlyPayment
    + other.monthlyPayment + card.monthlyPayment;

  return [
    buildPlan({
      key: 'normal-optimization',
      name: '不影响征信方案',
      impactLevel: '低',
      originalMonthlyPayment: payment,
      basis: '以正常履约为前提，优先做账期、分期和还款节奏优化。',
      calculations: [
        cardInstallmentRelief,
        calcRelief('非房贷还款节奏优化', nonMortgagePayment, 0.08, '在不改变账户性质的前提下，对非房贷月供做保守优化测算。'),
      ],
      advantages: ['征信连续性较好', '执行成本低', '适合短期现金流紧张客户'],
      risks: ['释放现金流有限', '需要客户持续按期履约'],
      complianceNote: '仅做现金流测算，不承诺任何授信、降息或减免结果。',
    }),
    buildPlan({
      key: 'mild-negotiation',
      name: '减轻影响征信方案',
      impactLevel: '中',
      originalMonthlyPayment: payment,
      basis: '以合规协商、账单分期、期限调整等可核验路径为主，优先处理消费贷、经营贷和信用卡。',
      calculations: [
        cardInstallmentRelief,
        calcRelief('消费贷协商调整空间', consumer.monthlyPayment, 0.30, '消费贷通常具备一定分期或期限调整空间，按中等强度测算。'),
        calcRelief('经营贷协商调整空间', business.monthlyPayment, 0.25, '经营贷需要结合续贷周期和经营流水，按较保守比例测算。'),
        calcRelief('其他非房贷调整空间', auto.monthlyPayment + other.monthlyPayment, 0.20, '车贷和其他贷款的调整空间相对有限，按较低比例测算。'),
      ],
      advantages: ['月供下降更明显', '仍保留较强的正常还款目标', '适合非房贷占比较高客户'],
      risks: ['部分机构可能在征信中体现账户调整信息', '最终结果取决于机构政策与客户资质'],
      complianceNote: '必须通过贷款机构或发卡机构的正式渠道办理。',
    }),
    buildPlan({
      key: 'term-extension',
      name: '延长还款方案',
      impactLevel: '高',
      originalMonthlyPayment: payment,
      basis: '以展期、重组或更长周期的还款安排做压力测算，目标是明显降低短期月供。',
      calculations: [
        calcRelief('房贷期限调整空间', mortgage.monthlyPayment, 0.15, '房贷调整通常审批严格，按低比例测算。'),
        calcRelief('非房贷展期重组空间', nonMortgagePayment, 0.55, '非房贷通过期限拉长释放短期月供，按较高比例测算。'),
      ],
      advantages: ['短期月供压力下降明显', '更适合高月供且短期收入波动较大场景'],
      risks: ['可能增加总利息或费用', '可能形成征信关注项或其他账户状态变化'],
      complianceNote: '应把征信影响、费用变化和合同条款作为前置核验项。',
    }),
    buildPlan({
      key: 'high-risk-resolution',
      name: '全案定制（高风险处置）',
      impactLevel: '极高',
      originalMonthlyPayment: payment,
      basis: '仅作为极端压力情景的现金流测算，不作为默认推荐。',
      calculations: [
        calcRelief('房贷高强度处置空间', mortgage.monthlyPayment, 0.35, '极端情景下可能涉及更强的合同调整或资产处置，风险较高。'),
        calcRelief('非房贷高强度处置空间', nonMortgagePayment, 0.78, '极端情景下对非房贷做高强度压降测算，仅用于风险评估。'),
      ],
      advantages: ['短期现金流释放最大', '可用于评估极端情景下的承压能力'],
      risks: ['征信、法律、费用和后续融资影响均可能较大', '不适合在未完成合同与法律核验前执行'],
      complianceNote: '不得诱导逃废债；任何处置都必须以真实沟通、合法合同和客户授权为前提。',
    }),
  ];
}

function buildPlan(input: {
  key: string;
  name: string;
  impactLevel: PlanImpactLevel;
  originalMonthlyPayment: number;
  basis: string;
  calculations: PlanCalculationLine[];
  advantages: string[];
  risks: string[];
  complianceNote: string;
}): PaymentReductionPlan {
  const validCalculations = input.calculations.filter((item) => item.amount > 0);
  const releasedCashFlow = Math.min(
    input.originalMonthlyPayment,
    validCalculations.reduce((sum, item) => sum + item.amount, 0),
  );
  const targetMonthlyPayment = Math.max(0, input.originalMonthlyPayment - releasedCashFlow);

  return {
    key: input.key,
    name: input.name,
    impactLevel: input.impactLevel,
    originalMonthlyPayment: input.originalMonthlyPayment,
    targetMonthlyPayment,
    releasedCashFlow,
    basis: input.basis,
    calculations: validCalculations.length > 0
      ? validCalculations
      : [{ label: '暂无可测算空间', amount: 0, explanation: '当前未识别到可用于该方案的有效月供组件。' }],
    advantages: input.advantages,
    risks: input.risks,
    complianceNote: input.complianceNote,
  };
}

function calcRelief(label: string, monthlyPayment: number, ratio: number, explanation: string): PlanCalculationLine {
  return {
    label,
    amount: Math.round(sanitizeAmount(monthlyPayment) * ratio),
    explanation,
  };
}

function calcCardInstallmentRelief(cards: InstallmentCardItem[]): PlanCalculationLine {
  const amount = cards.reduce((sum, card) => {
    if (card.usedAmount <= 0 || card.monthlyPayment <= 0) return sum;
    const estimatedInstallmentPayment = Math.ceil(card.usedAmount / 12);
    return sum + Math.max(0, card.monthlyPayment - estimatedInstallmentPayment);
  }, 0);

  return {
    label: '信用卡账单分期空间',
    amount: Math.round(amount),
    explanation: '按已用额度拆为 12 期的保守口径估算，仅用于识别潜在现金流空间。',
  };
}

function buildSummary(
  debtTotal: number,
  activeLoanCount: number,
  activeCardCount: number,
  originalMonthlyPayment: number,
  breakdown: DebtBreakdownItem[],
  metrics: DebtPressureMetrics,
): string[] {
  if (debtTotal <= 0 && originalMonthlyPayment <= 0) {
    return ['当前未识别到有效债务余额或月供数据，请先核对 OCR 结果中的贷款账户、信用卡账户和本月应还字段。'];
  }

  const leadingDebt = [...breakdown]
    .filter((item) => item.balance > 0)
    .sort((a, b) => b.balance - a.balance)[0];

  const lines = [
    `当前识别在贷余额合计 ${formatAmount(debtTotal)} 元，其中贷款账户 ${activeLoanCount} 笔，信用卡有用额账户 ${activeCardCount} 笔。`,
    `当前月供合计 ${formatAmount(originalMonthlyPayment)} 元，是后续降低月供测算的基准。`,
  ];

  if (leadingDebt) {
    lines.push(`余额占比最高的类别为${leadingDebt.label}，余额 ${formatAmount(leadingDebt.balance)} 元，占比 ${formatPercentValue(leadingDebt.balanceShare)}。`);
  }

  if (metrics.nonMortgageDebtShare !== null) {
    lines.push(`非房贷余额占比 ${formatPercentValue(metrics.nonMortgageDebtShare)}，对应月供 ${formatAmount(metrics.nonMortgagePayment)} 元，是优先分析的现金流调节区。`);
  }

  return lines;
}

function buildRiskNotes(report: CreditReport, originalMonthlyPayment: number): string[] {
  const notes = [
    '本报告基于征信 OCR 结构化数据自动生成，金额、月供和账户状态应以原始征信报告与机构账单复核为准。',
    '方案测算只用于现金流压力分析，不构成贷款产品推荐、授信承诺、债务减免承诺或法律意见。',
  ];

  if (originalMonthlyPayment <= 0) {
    notes.push('当前未识别到有效月供，方案对比暂只能作为结构模板，不能作为实际执行测算。');
  }

  const overdueCount = countCurrentOverdue(report);
  if (overdueCount > 0) {
    notes.push(`当前识别到 ${overdueCount} 个账户存在逾期信息，后续方案需要优先核验账户状态和征信影响。`);
  }

  return notes;
}

function countCurrentOverdue(report: CreditReport): number {
  const loanAccounts: LoanLike[] = [
    ...report.creditDetail.nonRevolvingLoans,
    ...report.creditDetail.revolvingLoansType1,
    ...report.creditDetail.revolvingLoansType2,
  ];
  const loanOverdue = loanAccounts.filter((account) => (account.currentOverdueCount ?? 0) > 0).length;
  const cardOverdue = report.creditDetail.creditCards.filter((account) => (account.currentOverdueCount ?? 0) > 0).length;
  return loanOverdue + cardOverdue;
}

function getBucketItem(breakdown: DebtBreakdownItem[], key: DebtCategory): DebtBreakdownItem {
  return breakdown.find((item) => item.key === key) ?? {
    key,
    label: CATEGORY_LABELS[key],
    count: 0,
    balance: 0,
    monthlyPayment: 0,
    balanceShare: null,
    paymentShare: null,
    paymentRate: null,
  };
}

function sanitizeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

function formatPercentValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 1000) / 10}%`;
}
