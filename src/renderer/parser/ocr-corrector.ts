/**
 * OCR 领域词典校正 — 征信报告专用
 *
 * 两层校正策略：
 * 1. 形近字映射：修复 OCR 常见的单字替换错误（如 幸→窑）
 * 2. 术语词典：征信报告中的固定术语，用正则做模糊匹配后替换为标准写法
 *
 * 设计原则：纯函数、零依赖、可独立测试
 */

/**
 * 征信报告固定术语表
 * OCR 只要识别出大部分字就能匹配，用正则容错
 */
const CREDIT_TERMS: string[] = [
  '个人信用报告', '报告编号', '查询时间', '报告时间',
  '被查询者姓名', '被查询者证件类型', '被查询者证件号码',
  '查询机构', '查询原因', '身份信息', '配偶信息',
  '居住信息', '职业信息', '手机号码',
  '信息概要', '信贷交易信息提示', '信贷交易违约信息概要',
  '非循环贷账户', '循环贷账户', '贷记卡账户', '准贷记卡账户',
  '相关还款责任', '授信协议信息',
  '管理机构', '发卡机构', '业务种类', '担保方式',
  '借款金额', '授信额度', '共享授信额度', '已用额度',
  '账户状态', '五级分类', '余额', '剩余还款期数',
  '本月应还款', '应还款日', '本月实还款', '最近一次还款日期',
  '当前逾期期数', '当前逾期总额',
  '逾期31-60天未归还贷款本金',
  '逾期61-90天未归还贷款本金',
  '逾期91-180天未归还贷款本金',
  '逾期180天以上未归还贷款本金',
  '特殊交易', '还款记录', '开立日期', '到期日期',
  '还款频率', '还款方式', '共同借款标志',
  '大额专项分期信息', '查询记录',
  '机构查询记录明细', '本人查询记录明细',
  '贷后管理', '贷款审批', '信用卡审批', '担保资格审查',
  '币种', '人民币', '美元',
  '正常', '结清', '转出', '呆账', '逾期',
  '信用', '保证', '抵押', '质押',
  '住房公积金', '养老保险金',
];

const CREDIT_TERM_SET = new Set(CREDIT_TERMS);

/**
 * 形近字映射表
 * key: OCR 常见错误字, value: 正确字
 * 持续从实际 OCR 错误中积累
 */
const SIMILAR_CHAR_MAP: Record<string, string> = {
  '窑': '幸', // 幸福 → 窑福
  '佘': '余', // 余额 → 佘额
  '祟': '崇',
  '壸': '壶',
  '巳': '已', // 已用额度 → 巳用额度
  '己': '已', // 上下文中"己用"应为"已用"（仅在术语上下文中替换）
  '曰': '日', // 日期 → 曰期
  '贷己': '贷记', // 贷记卡 → 贷己卡
  '帐': '账', // 账户 → 帐户（虽然帐也对，但征信报告标准用"账"）
  '份': '份',
  '坏': '环', // 循环 → 循坏
  '颁': '额', // 额度 → 颁度
  '锁': '销', // 销户 → 锁户
  '侣': '侶',
};

/**
 * 上下文感知的形近字替换规则
 * 只在特定上下文中才替换，避免误伤
 */
const CONTEXT_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /窑福/g, replacement: '幸福' },
  { pattern: /佘额/g, replacement: '余额' },
  { pattern: /巳用/g, replacement: '已用' },
  { pattern: /己用额/g, replacement: '已用额' },
  { pattern: /曰期/g, replacement: '日期' },
  { pattern: /贷己卡/g, replacement: '贷记卡' },
  { pattern: /帐户/g, replacement: '账户' },
  { pattern: /循坏/g, replacement: '循环' },
  { pattern: /颁度/g, replacement: '额度' },
  { pattern: /锁户/g, replacement: '销户' },
  { pattern: /担保万式/g, replacement: '担保方式' },
  { pattern: /业务种炎/g, replacement: '业务种类' },
  { pattern: /还款其数/g, replacement: '还款期数' },
  { pattern: /逾其/g, replacement: '逾期' },
  { pattern: /五级分炎/g, replacement: '五级分类' },
  { pattern: /查洵/g, replacement: '查询' },
  { pattern: /机枃/g, replacement: '机构' },
  { pattern: /信贷交昜/g, replacement: '信贷交易' },
  { pattern: /违纟/g, replacement: '违约' },
];

/**
 * 对 OCR 文本做领域词典校正
 * 执行顺序：上下文替换 → 术语模糊匹配
 */
export function correctOcrText(text: string): string {
  let result = text;

  // 第一层：上下文感知的形近字替换
  for (const rule of CONTEXT_REPLACEMENTS) {
    result = result.replace(rule.pattern, rule.replacement);
  }

  // 第二层：术语模糊匹配修复
  result = fixTermsByFuzzyMatch(result);

  return result;
}

/**
 * 对 DocParserResult 做原地词典校正
 * 遍历所有 layouts.text、tables.markdown、tables.cells[].text 做替换
 * 确保解析器从 docResult 直接读取的数据也被校正
 */
export function correctDocResult(doc: import('../../shared/doc-parser-types').DocParserResult): void {
  for (const page of doc.pages) {
    for (const layout of page.layouts) {
      if (layout.text) {
        layout.text = correctOcrText(layout.text);
      }
    }
    for (const table of page.tables) {
      if (table.markdown) {
        table.markdown = correctOcrText(table.markdown);
      }
      for (const cell of table.cells) {
        if (cell.text) {
          cell.text = correctOcrText(cell.text);
        }
      }
    }
  }
}

/**
 * 术语模糊匹配：对每个标准术语，在文本中搜索编辑距离 ≤1 的变体并替换
 * 只处理长度 ≥3 的术语，避免短词误匹配
 */
function fixTermsByFuzzyMatch(text: string): string {
  let result = text;

  for (const term of CREDIT_TERMS) {
    if (term.length < 3) continue;
    const regex = buildFuzzyRegex(term);
    if (!regex) continue;

    result = result.replace(regex, (match) => {
      if (match === term) return match; // 已经正确，跳过
      if (CREDIT_TERM_SET.has(match)) return match; // 不把一个标准术语改成另一个标准术语
      if (!isSafeTermReplacement(match, term)) return match;
      return term;
    });
  }

  return result;
}

/**
 * 为术语构建模糊正则：允许每个字符位置有一个字不同
 * 例如 "余额" → /(余.|.额)/g
 * 只对 3 字以上术语生效，要求至少 n-1 个字匹配
 */
function buildFuzzyRegex(term: string): RegExp | null {
  if (term.length < 3) return null;

  const chars = [...term];
  const variants: string[] = [];

  // 生成每个位置替换一个字的变体模式
  for (let i = 0; i < chars.length; i++) {
    const parts = chars.map((c, j) => (i === j ? '[\\u4e00-\\u9fa5]' : escapeRegex(c)));
    variants.push(parts.join(''));
  }

  try {
    return new RegExp(`(${variants.join('|')})`, 'g');
  } catch {
    return null;
  }
}

function isSafeTermReplacement(match: string, term: string): boolean {
  if (match.length !== term.length) return false;
  if (/[0-9A-Za-z]/.test(match)) return false;
  if (countSameChars(match, term) < term.length - 1) return false;
  if (term.length <= 3) {
    return match[0] === term[0] || match[match.length - 1] === term[term.length - 1];
  }
  return hasCommonBigram(match, term);
}

function countSameChars(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) count++;
  }
  return count;
}

function hasCommonBigram(a: string, b: string): boolean {
  const grams = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) grams.add(b.slice(i, i + 2));
  for (let i = 0; i < a.length - 1; i++) {
    if (grams.has(a.slice(i, i + 2))) return true;
  }
  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
