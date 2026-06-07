# 历史模块与辅助链路状态

以下内容用于区分“确实未接入主界面”“仍在当前 OCR/解析链路中使用”和“仅作为兼容回退保留”的模块，避免后续清理时误删仍被调用的路径。

## UI 旧组件

- `src/renderer/components/CreditForm.tsx`：早期 13 字段简化表单，当前主界面改为 `CreditReportTabs`。
- `src/renderer/components/tabs/BasicInfoTab.tsx`：早期基础信息 Tab，当前使用 `PersonalInfoTab`。
- `src/renderer/components/tabs/AccountDetailTab.tsx`：早期账户简表 Tab，当前账户展示集中在 `CreditDetailTab`。
- `src/renderer/components/tabs/OverdueTab.tsx`：早期逾期/负债概览 Tab，当前由 `CreditAssessmentTab` 和账户明细承担。

## 冷宫模块（暂不接入，保留召回能力）

- 产品匹配功能已从当前产品主线中下线，相关实现暂时保留但不接入主界面：
  - `src/renderer/components/ProductDrawer.tsx`
  - `src/renderer/components/ProductForm.tsx`
  - `src/renderer/components/WeightConfigModal.tsx`
  - `src/renderer/services/product-matcher.ts`
  - `src/renderer/services/product-store.ts`
  - `src/renderer/types/product-rule.ts`
- 这些文件不应参与当前 OCR、征信评估、债务分析和导出链路的改造。若后续需要“召回”产品匹配，应重新评估产品规则、机构库标准名、征信画像字段和主界面入口，再恢复接入。

## 当前仍在使用的 OCR 辅助路径

- `src/renderer/services/pdf-to-image.ts`：扫描版 PDF 的 TextIn 原始解析质量不足时，`ocr-service.ts` 会将 PDF 逐页渲染成图片再调用 TextIn，比选“原始 PDF OCR”和“逐页渲染 OCR”的结构质量。
- `src/renderer/services/image-preprocess.ts`：图片 OCR 或逐页渲染 OCR 的结构质量不足时，`ocr-service.ts` 会生成增强对比、轻二值化、自适应二值化候选图，再按 OCR 质量分选择最佳结果。

这两个模块不是废弃路径，而是当前 OCR 候选增强链路的一部分。

## 兼容回退路径

- `src/renderer/parser/table-rebuilder.ts`、`src/renderer/parser/table-lookup.ts`：旧坐标重建表格路径。当前主力是 `DocParserResult -> ContextTable[]`，但 `parser/index.ts`、`summary-from-accounts.ts`、`account-overdue-parser.ts` 仍保留 `RebuiltTable` 兼容参数和工具引用。清理前需要先确认旧 `RebuiltTable` 入参不再被任何外部入口使用。

## 暂未接入主链路的旧实验路径

- `src/renderer/services/llm-ocr-corrector.ts`：LLM OCR 纠错实验路径，当前默认只使用词典校正。
- `src/renderer/parser/section-splitter.ts`、`extract-utils.ts`、`extractors/`、`cross-validator.ts`：早期纯文本正则解析和交叉验证工具。

## 清理建议

1. 不要删除 `pdf-to-image.ts` 和 `image-preprocess.ts`，除非同时移除 `ocr-service.ts` 中的 OCR 候选增强逻辑。
2. 若清理 `table-rebuilder.ts` / `table-lookup.ts`，先移除 `parseCreditReport(fullText, table, docResult)` 的旧 `table` 参数和所有 `RebuiltTable` 兼容分支。
3. UI 旧组件和旧实验路径可继续保留一个版本周期；若决定删除，应同步清理文档、测试和导入引用。
