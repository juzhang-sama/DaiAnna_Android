import assert from 'node:assert/strict';
import type { DocLayout, DocParserResult, DocTable } from '../../../shared/doc-parser-types';
import { fuseDocParserCandidateTables } from '../doc-parser-candidate-fusion';

function makeDoc(
  fileName: string,
  markdown: string,
  position: [number, number, number, number] = [100, 200, 800, 160],
): DocParserResult {
  const layout: DocLayout = {
    layout_id: `${fileName}:table-1`,
    text: markdown,
    position,
    type: 'table',
    sub_type: '',
    parent: '',
    children: [],
  };
  const table: DocTable = {
    layout_id: layout.layout_id,
    markdown,
    position,
    cells: [],
    matrix: [],
    merge_table: '',
  };

  return {
    file_name: fileName,
    file_id: fileName,
    pages: [{
      page_id: `${fileName}:page-1`,
      page_num: 0,
      text: '',
      layouts: [layout],
      tables: [table],
      images: [],
      meta: {
        page_width: 1200,
        page_height: 1600,
        is_scan: true,
        page_angle: 0,
        page_type: '',
      },
    }],
  };
}

const noisySelected = makeDoc('selected', [
  '| 管理机构 | 开立日期 | 借款金额 | 账户状态 |',
  '| --- | --- | --- | --- |',
  '| 建设银 | 2020.01.01 | 12500 | 结清 |',
].join('\n'));

const betterCandidate = makeDoc('candidate', [
  '| 管理机构 | 开立日期 | 借款金额 | 账户状态 |',
  '| --- | --- | --- | --- |',
  '| 中国建设银行股份有限公司 | 2020.01.01 | 12500 | 结清 |',
].join('\n'), [105, 202, 795, 158]);

const fused = fuseDocParserCandidateTables(noisySelected, [noisySelected, betterCandidate]);
assert.equal(fused.pages[0].tables.length, 1);
assert.match(fused.pages[0].tables[0].markdown, /中国建设银行股份有限公司/);
assert.doesNotMatch(fused.pages[0].tables[0].markdown, /\| 建设银 \|/);
assert.match(noisySelected.pages[0].tables[0].markdown, /建设银/);

const weakCandidate = makeDoc('weak', [
  '| 备注 | 值 |',
  '| --- | --- |',
  '| 测试 | 1 |',
].join('\n'), [105, 202, 795, 158]);
const unchanged = fuseDocParserCandidateTables(noisySelected, [noisySelected, weakCandidate]);
assert.match(unchanged.pages[0].tables[0].markdown, /建设银/);
