import assert from 'node:assert/strict';
import { correctOcrText } from '../ocr-corrector';

const corrected = correctOcrText('贷己卡账户 巳用额度 12,000 本月应还款 1,200');
assert.equal(corrected.includes('贷记卡账户'), true);
assert.equal(corrected.includes('已用额度'), true);
assert.equal(corrected.includes('12,000'), true);
assert.equal(correctOcrText('本月应还款'), '本月应还款');
assert.equal(correctOcrText('本月实还款'), '本月实还款');

const safe = correctOcrText('合同编号 ABC12345 金额 10000');
assert.equal(safe, '合同编号 ABC12345 金额 10000');
