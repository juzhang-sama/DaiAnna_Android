# 征信报告解析系统 - 技术架构文档

## 项目概述

**项目名称**: LoanIntelligence Parser (征信报告解析系统)  
**版本**: 0.1.0  
**定位**: 助贷征信解析专家 — 自动解析央行二代个人征信报告 PDF，提取结构化数据

## 技术栈

| 层级 | 技术选型 |
|------|----------|
| 桌面框架 | Electron 40.x |
| 前端框架 | React 19 + TypeScript 5.9 |
| UI 组件库 | Ant Design 6.x |
| 样式方案 | Tailwind CSS 4.x |
| 构建工具 | Vite 7.x |
| PDF 解析 | pdfjs-dist 5.x |
| OCR 服务 | TextIn 文档解析 API |
| LLM 服务 | DeepSeek API |
| 数据导出 | 自生成 XLSX / DOCX 文件（fflate 打包 OpenXML） |
| 本地存储 | Electron userData / localStorage；lowdb 仅用于冷宫产品库 |

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron Main Process                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ textin-ocr  │  │deepseek-cli │  │   api-key-store     │  │
│  │  (OCR API)  │  │  (LLM API)  │  │   (密钥管理)         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                         ↑ IPC                                │
├─────────────────────────┼───────────────────────────────────┤
│                         ↓                                    │
│                   Renderer Process                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    App.tsx                            │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │   │
│  │  │ PdfViewer  │  │CreditReport│  │ DebtAnalysis   │  │   │
│  │  │            │  │   Tabs     │  │ Report Tab     │  │   │
│  │  └────────────┘  └────────────┘  └────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   Services 层                         │   │
│  │  ocr-service → parser → credit-assessment            │   │
│  └────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
src/
├── main/                    # Electron 主进程
│   ├── index.ts             # 主进程入口，窗口创建，IPC 注册
│   ├── preload.ts           # 预加载脚本，暴露安全 API
│   ├── textin-ocr.ts        # TextIn OCR API 封装
│   ├── deepseek-client.ts   # DeepSeek LLM API 封装
│   ├── api-key-store.ts     # API 密钥持久化存储
│   └── doc-parser-cache.ts  # OCR 结果缓存
│
├── renderer/                # 渲染进程（React 应用）
│   ├── App.tsx              # 应用根组件
│   ├── components/          # UI 组件
│   │   ├── PdfViewer.tsx    # PDF 预览组件
│   │   ├── CreditReportTabs.tsx  # 报告数据展示
│   │   ├── ProductDrawer.tsx     # 冷宫产品匹配入口（当前不接入主界面）
│   │   └── tabs/            # 各数据模块 Tab
│   ├── parser/              # 征信报告解析引擎（核心）
│   │   ├── index.ts         # 解析入口
│   │   ├── block-recognizer.ts   # 区块识别器
│   │   ├── block-parsers/   # 各模块解析器
│   │   └── extractors/      # 字段提取器
│   ├── services/            # 业务服务
│   │   ├── ocr-service.ts   # OCR 调度（电子版/扫描件）
│   │   ├── credit-assessment.ts  # 信用评估
│   │   └── excel-export.ts  # Excel 导出
│   └── types/               # TypeScript 类型定义
│       └── credit-report.ts # 征信报告完整数据结构
│
└── shared/                  # 主进程/渲染进程共享
    ├── doc-parser-types.ts  # 文档解析结果类型
    └── ocr-types.ts         # OCR 相关类型
```

## 核心数据流

```
PDF 文件
    │
    ▼
┌─────────────────────────────────────────┐
│ 路径判断：电子版 or 扫描件？              │
│ (基于 pdfjs 提取文本长度判断)             │
└─────────────────────────────────────────┘
    │                    │
    ▼                    ▼
电子版 PDF            扫描件 PDF
    │                    │
    ▼                    ▼
pdfjs 直提文本      TextIn OCR API
    │                    │
    └────────┬───────────┘
             ▼
    ┌─────────────────┐
    │  解析引擎 Parser │
    │  (区块识别+提取) │
    └─────────────────┘
             │
             ▼
    ┌─────────────────┐
    │  CreditReport   │
    │  (结构化数据)    │
    └─────────────────┘
             │
    ┌────────┴────────┐
    ▼                 ▼
UI 展示          Excel/Word 导出
```

## 解析引擎架构

解析引擎采用**区块识别 + 分模块解析**的设计：

1. **区块识别器** (`block-recognizer.ts`)
   - 将全文按行分割，识别一级/二级模块边界
   - 输出 BlockMap：记录各模块的行号范围

2. **模块解析器** (`block-parsers/`)
   - `header-parser.ts` — 报告头信息
   - `identity-parser.ts` — 身份/配偶/职业信息
   - `non-revolving-loan-parser.ts` — 非循环贷账户
   - `credit-card-parser.ts` — 贷记卡账户
   - `query-record-parser.ts` — 查询记录
   - ...

3. **表格处理** (`doc-table-bridge.ts`, `table-classifier.ts`)
   - 从 OCR 结果提取结构化表格
   - 按类型分类（报告头/身份/账户/查询等）

## IPC 通信

| 通道 | 方向 | 用途 |
|------|------|------|
| `ocr:parseDocument` | Renderer → Main | 调用 TextIn OCR |
| `llm:chat` | Renderer → Main | 调用 DeepSeek LLM |
| `config:getKeys` | Renderer → Main | 获取 API 密钥 |
| `config:setKeys` | Renderer → Main | 保存 API 密钥 |
| `config:hasKeys` | Renderer → Main | 检查密钥是否配置 |

## 构建与打包

```bash
# 开发模式
npm run dev          # 统一启动 Vite + Electron，默认端口 5175

# 生产构建
npm run build        # 构建 renderer + main
npm run pack         # 打包为 Windows 安装程序 (NSIS)
```

## 开发启动配置

- 默认开发地址：`http://localhost:5175`
- 可通过环境变量覆盖：
  - `DEV_SERVER_PORT` / `VITE_DEV_SERVER_PORT`
  - `DEV_SERVER_HOST`
  - `ELECTRON_RENDERER_URL`
- Electron 主进程不再直接写死端口，优先读取 `ELECTRON_RENDERER_URL`。

## 安全与本地数据

- API Key 存储在 Electron `userData` 下，并优先使用 `safeStorage` 加密。
- OCR 文档解析缓存按文件内容 hash 存储，默认 30 天过期。
- 设置弹窗提供 OCR 缓存统计和清理入口。
- OCR 调试日志默认关闭，需显式设置 `DEBUG_LOGS=true` 或 `VITE_DEBUG_LOGS=true`。

输出目录：
- `dist/renderer/` — 前端静态资源
- `dist/main/` — 主进程编译产物
- `release2/` — 安装包 (.exe)
