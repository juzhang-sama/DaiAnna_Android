# 项目上下文

> 当前上下文基于 2026-06-05 的代码状态整理。

## 一、项目定位

本项目是一个 Electron 桌面端征信报告解析工具，面向助贷/信贷业务场景。用户上传央行二代个人征信报告 PDF 或图片后，系统自动提取结构化数据，展示账户明细、查询记录、信用评估、债务分析结果，并支持导出 Excel/Word。

核心目标不是简单 OCR，而是把征信报告中的表格、账户、查询记录和授信信息转成可校验、可编辑、可导出的业务数据。

## 二、当前技术栈

| 模块 | 当前实现 |
| --- | --- |
| 桌面框架 | Electron |
| 前端 | React + TypeScript + Ant Design |
| 构建 | Vite + TypeScript |
| 电子 PDF 文本层 | pdfjs-dist |
| 扫描件/图片文档解析 | TextIn 文档解析 API |
| LLM 说明生成 | DeepSeek API |
| 本地配置 | Electron userData + safeStorage |
| 冷宫产品库 | lowdb/localStorage（产品匹配已下线，代码保留待召回） |
| Excel 导出 | 手写 OpenXML，使用 fflate 打包 XLSX |

## 三、运行时数据流

```text
上传 PDF/图片
  -> renderer/services/ocr-service.ts
  -> 电子 PDF: pdfjs-dist 提取文本
  -> 扫描 PDF/图片: IPC 调主进程 TextIn 文档解析
  -> DocParserResult / fullText
  -> renderer/parser/index.ts
  -> CreditReport + ClientProfile
  -> UI 展示、信用评估、债务分析、Excel/Word 导出
```

## 四、OCR/TextIn 适配

主进程入口在 `src/main/textin-ocr.ts`。它负责调用 TextIn，并把 TextIn 的 `pages[].structured`、HTML table、正文 layout 转换成项目内部统一的 `DocParserResult`。

适配层的关键工作：

- 将 TextIn HTML 表格转成 pipe-delimited Markdown。
- 为每张表补充 `type='table'` 的 layout 占位，方便渲染端按 layout/table 关联。
- 从页脚识别逻辑页码，用于页面重排和左右栏定位。
- 对 colspan 做重复填充，以兼容既有账户解析器对合并单元格展开后的假设。

渲染端只通过 `src/renderer/services/textin-document-parser.ts` 调用 `window.electron.parseDocument()`，不直接接触 TextIn 密钥。

## 五、解析器结构

解析入口是 `src/renderer/parser/index.ts`。

主要步骤：

1. `recognizeBlocks()` 从全文行模式中识别一级/二级模块边界。
2. `extractTablesFromDoc()` 从 `DocParserResult` 中提取 Markdown 表格和上下文。
3. `classifyTables()` 将表格分到报告头、身份信息、信贷账户、授信协议、查询记录等桶。
4. `scanLevel1Sections()` / `scanLevel2CreditSections()` 根据 layouts 定位左右栏章节。
5. `groupAccountTables()` 将信贷账户表按非循环贷、循环贷一、循环贷二、贷记卡、还款责任、授信协议分组。
6. 各 `block-parsers/` 解析具体账户和业务字段。
7. `buildClientProfile()` 从完整 `CreditReport` 派生简化客户画像。

## 六、配置与安全

API Key 通过设置弹窗录入，保存在 Electron `userData/api-keys.json` 中。可用时使用 `safeStorage` 加密；不可用时降级为明文 JSON。TextIn 和 DeepSeek 密钥都不应写入源码或日志。

OCR 文档解析结果会按文件内容 hash 缓存到 `userData/doc-parser-cache`，默认 30 天过期。设置弹窗提供缓存统计和清理入口。

## 七、当前验证方式

项目内置检查：

```bash
npm run typecheck
npm test
npm run build
```

辅助脚本：

```bash
node scripts/verify-blocks.mjs "full text view.txt"
node scripts/verify-parse2.mjs "full text view.txt"
```

这些脚本用于本地文本样本调试，不依赖固定磁盘路径。

## 八、维护重点

- 解析稳定性优先于 UI 扩展，特别是跨页表格、左右栏续表、OCR 错字和合并单元格。
- 新增解析规则时应尽量补充 fixture 测试，覆盖 `DocParserResult` -> 表格分类 -> 账户分组 -> 业务字段提取。
- 历史文档中的百度 OCR 记录仅作为迁移背景；当前运行时主路径是 TextIn。
- 业务字段应尽量保留 provenance，方便用户回查来源页和来源表。
- 产品匹配已打入冷宫：相关代码保留但不接入主界面，后续如需召回，应先重新校准产品规则、机构库和征信画像字段。
