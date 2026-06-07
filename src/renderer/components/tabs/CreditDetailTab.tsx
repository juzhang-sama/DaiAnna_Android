import React, { useEffect, useState } from 'react';
import { Alert, Grid, Table, Tabs } from 'antd';
import type { AccountDerivedMap, AccountDerivedSummary, CreditReport } from '../../types/credit-report';
import EditableCell from '../EditableCell';
import {
  buildReviewFieldDomId,
  type CreditReviewSectionKey,
  type ReviewNavigationTarget,
} from '../../services/review-navigation';
import { useReviewFocus } from '../../hooks/useReviewFocus';

interface CreditDetailTabProps {
  report: CreditReport;
  onChange: (report: CreditReport) => void;
  reviewTarget?: ReviewNavigationTarget;
}

const OCR_TIP = '部分数值由 OCR 识别生成，如有不确定建议参考原件。点击数值可修改。';

const EMPTY_DERIVED_SUMMARY: AccountDerivedSummary = {
  orgCount: 0,
  accountCount: 0,
  totalCredit: 0,
  balance: 0,
  monthlyPayment: 0,
};

const DERIVED_SUMMARY_ITEMS: Array<{ key: keyof AccountDerivedMap; label: string }> = [
  { key: 'nonRevolvingLoan', label: '非循环贷' },
  { key: 'revolvingLoan1', label: '循环贷一' },
  { key: 'revolvingLoan2', label: '循环贷二' },
  { key: 'creditCard', label: '贷记卡' },
];

/**
 * 三、信贷交易信息明细
 * 包含二级章节：非循环贷账户、循环贷账户一、循环贷账户二、贷记卡账户、相关还款责任、授信协议信息
 */
const CreditDetailTab: React.FC<CreditDetailTabProps> = ({ report, onChange, reviewTarget }) => {
  const screens = Grid.useBreakpoint();
  const tabPosition = screens.md ? 'left' : 'top';
  const { creditDetail, repayResponsibilities, creditAgreements, accountDerived } = report;
  const [activeSection, setActiveSection] = useState<CreditReviewSectionKey>('nonRevolvingLoan');
  useReviewFocus(reviewTarget, reviewTarget?.destinationTab === 'credit');

  useEffect(() => {
    if (reviewTarget?.destinationTab !== 'credit' || !reviewTarget.creditSectionKey) return;
    if (reviewTarget.creditSectionKey !== 'summary') {
      setActiveSection(reviewTarget.creditSectionKey);
    }
  }, [reviewTarget?.creditSectionKey, reviewTarget?.destinationTab, reviewTarget?.focusToken]);

  // 账户数统计
  const accountCounts = {
    nonRevolvingLoan: accountDerived.nonRevolvingLoan?.accountCount ?? creditDetail.nonRevolvingLoans.length,
    revolvingLoan1: accountDerived.revolvingLoan1?.accountCount ?? creditDetail.revolvingLoansType1.length,
    revolvingLoan2: accountDerived.revolvingLoan2?.accountCount ?? creditDetail.revolvingLoansType2.length,
    creditCard: accountDerived.creditCard?.accountCount ?? creditDetail.creditCards.length,
  };

  const STATUS_FILTERS = [
    { text: '正常', value: '正常' },
    { text: '结清', value: '结清' },
    { text: '销户', value: '销户' },
    { text: '呆账', value: '呆账' },
    { text: '逾期', value: '逾期' },
    { text: '冻结', value: '冻结' },
    { text: '止付', value: '止付' },
  ];

  const reviewProps = (field: string) => {
    const reviewFieldId = buildReviewFieldDomId(field);
    return {
      reviewFieldId,
      reviewFocused: reviewTarget?.anchorId === reviewFieldId,
      reviewFocusToken: reviewTarget?.focusToken,
    };
  };

  const rowField = (listName: string, index: number, field: string) => `${listName}[${index}].${field}`;

  const editableStatusColumn = (
    listName: string,
    updater: (i: number, f: string, v: string | number | null) => void,
  ) => ({
    title: '账户状态',
    dataIndex: 'status',
    key: 'status',
    width: 100,
    render: (v: string, rec: any) => {
      const rowIndex = Number(rec.key);
      return (
        <EditableCell
          value={v}
          onChange={(nv) => updater(rowIndex, 'status', String(nv))}
          {...reviewProps(rowField(listName, rowIndex, 'status'))}
        />
      );
    },
    filters: STATUS_FILTERS,
    onFilter: (value: any, record: any) => record.status === value,
  });

  /** 更新非循环贷某行某字段 */
  const updateNrl = (idx: number, field: string, val: string | number | null) => {
    const list = [...creditDetail.nonRevolvingLoans];
    list[idx] = { ...list[idx], [field]: val };
    onChange({ ...report, creditDetail: { ...creditDetail, nonRevolvingLoans: list } });
  };

  /** 更新循环贷一某行某字段 */
  const updateRl1 = (idx: number, field: string, val: string | number | null) => {
    const list = [...creditDetail.revolvingLoansType1];
    list[idx] = { ...list[idx], [field]: val };
    onChange({ ...report, creditDetail: { ...creditDetail, revolvingLoansType1: list } });
  };

  /** 更新循环贷二某行某字段 */
  const updateRl2 = (idx: number, field: string, val: string | number | null) => {
    const list = [...creditDetail.revolvingLoansType2];
    list[idx] = { ...list[idx], [field]: val };
    onChange({ ...report, creditDetail: { ...creditDetail, revolvingLoansType2: list } });
  };

  /** 更新贷记卡某行某字段 */
  const updateCard = (idx: number, field: string, val: string | number | null) => {
    const list = [...creditDetail.creditCards];
    list[idx] = { ...list[idx], [field]: val };
    onChange({ ...report, creditDetail: { ...creditDetail, creditCards: list } });
  };

  /** 更新还款责任某行某字段 */
  const updateRepay = (idx: number, field: string, val: string | number | null) => {
    const list = [...repayResponsibilities];
    list[idx] = { ...list[idx], [field]: val };
    onChange({ ...report, repayResponsibilities: list });
  };

  /** 更新授信协议某行某字段 */
  const updateAgreement = (idx: number, field: string, val: string | number | null) => {
    const list = [...creditAgreements];
    list[idx] = { ...list[idx], [field]: val };
    onChange({ ...report, creditAgreements: list });
  };

  const updateDerived = (
    summaryKey: keyof AccountDerivedMap,
    field: keyof AccountDerivedSummary,
    val: number,
  ) => {
    const previous = accountDerived[summaryKey] ?? EMPTY_DERIVED_SUMMARY;
    onChange({
      ...report,
      accountDerived: {
        ...accountDerived,
        [summaryKey]: {
          ...previous,
          [field]: val,
        },
      },
    });
  };

  /** 生成可编辑数值列的 render */
  const editableNum = (
    listName: string,
    field: string,
    updater: (i: number, f: string, v: number | null) => void,
  ) =>
    (v: number | null, rec: any) => {
      const rowIndex = Number(rec.key);
      return (
        <EditableCell
          value={v ?? 0}
          type="number"
          onChange={(nv) => updater(rowIndex, field, Number(nv))}
          {...reviewProps(rowField(listName, rowIndex, field))}
        />
      );
    };

  const editableText = (
    listName: string,
    field: string,
    updater: (i: number, f: string, v: string | number | null) => void,
  ) =>
    (v: string | number | null, rec: any) => {
      const rowIndex = Number(rec.key);
      return (
        <EditableCell
          value={v ?? ''}
          onChange={(nv) => updater(rowIndex, field, String(nv))}
          {...reviewProps(rowField(listName, rowIndex, field))}
        />
      );
    };

  const items = [
    {
      key: 'nonRevolvingLoan',
      label: `(一) 非循环贷账户 (${accountCounts.nonRevolvingLoan})`,
      children: (
        <>
          <Alert title={OCR_TIP} type="info" showIcon style={{ marginBottom: 8 }} />
          <Table
            dataSource={creditDetail.nonRevolvingLoans.map((a, i) => ({ ...a, key: i }))}
            columns={[
              { title: '管理机构', dataIndex: 'org', key: 'org', width: 180, fixed: 'left' as const, render: editableText('nonRevolvingLoans', 'org', updateNrl) },
              { title: '借款金额', dataIndex: 'loanAmount', key: 'loanAmount', width: 90, render: editableNum('nonRevolvingLoans', 'loanAmount', updateNrl) },
              { title: '业务种类', dataIndex: 'businessType', key: 'businessType', width: 130, render: editableText('nonRevolvingLoans', 'businessType', updateNrl) },
              { title: '担保方式', dataIndex: 'guaranteeType', key: 'guaranteeType', width: 100, render: editableText('nonRevolvingLoans', 'guaranteeType', updateNrl) },
              { title: '还款期数', dataIndex: 'termCount', key: 'termCount', width: 80, render: editableNum('nonRevolvingLoans', 'termCount', updateNrl) },
              { title: '还款方式', dataIndex: 'repayMethod', key: 'repayMethod', width: 110, render: editableText('nonRevolvingLoans', 'repayMethod', updateNrl) },
              editableStatusColumn('nonRevolvingLoans', updateNrl),
              { title: '余额', dataIndex: 'balance', key: 'balance', width: 90, render: editableNum('nonRevolvingLoans', 'balance', updateNrl) },
              { title: '剩余期数', dataIndex: 'remainTerms', key: 'remainTerms', width: 80, render: editableNum('nonRevolvingLoans', 'remainTerms', updateNrl) },
              { title: '本月应还', dataIndex: 'monthlyPayment', key: 'monthlyPayment', width: 90, render: editableNum('nonRevolvingLoans', 'monthlyPayment', updateNrl) },
              { title: '应还款日', dataIndex: 'paymentDueDate', key: 'paymentDueDate', width: 100, render: editableText('nonRevolvingLoans', 'paymentDueDate', updateNrl) },
              { title: '本月实还', dataIndex: 'actualPayment', key: 'actualPayment', width: 90, render: editableNum('nonRevolvingLoans', 'actualPayment', updateNrl) },
              { title: '逾期期数', dataIndex: 'currentOverdueCount', key: 'currentOverdueCount', width: 80, render: editableNum('nonRevolvingLoans', 'currentOverdueCount', updateNrl) },
              { title: '逾期总额', dataIndex: 'currentOverdueAmount', key: 'currentOverdueAmount', width: 90, render: editableNum('nonRevolvingLoans', 'currentOverdueAmount', updateNrl) },
            ]}
            size="small"
            pagination={false}
            scroll={{ x: 1600 }}
            sticky
            locale={{ emptyText: '暂无非循环贷账户数据' }}
          />
        </>
      ),
    },
    {
      key: 'revolvingLoan1',
      label: `(二) 循环贷账户一 (${accountCounts.revolvingLoan1})`,
      children: (
        <>
          <Alert title={OCR_TIP} type="info" showIcon style={{ marginBottom: 8 }} />
          <Table
            dataSource={creditDetail.revolvingLoansType1.map((a, i) => ({ ...a, key: i }))}
            columns={[
              { title: '管理机构', dataIndex: 'org', key: 'org', width: 180, fixed: 'left' as const, render: editableText('revolvingLoansType1', 'org', updateRl1) },
              { title: '借款金额', dataIndex: 'loanAmount', key: 'loanAmount', width: 90, render: editableNum('revolvingLoansType1', 'loanAmount', updateRl1) },
              { title: '业务种类', dataIndex: 'businessType', key: 'businessType', width: 130, render: editableText('revolvingLoansType1', 'businessType', updateRl1) },
              { title: '担保方式', dataIndex: 'guaranteeType', key: 'guaranteeType', width: 100, render: editableText('revolvingLoansType1', 'guaranteeType', updateRl1) },
              { title: '还款期数', dataIndex: 'termCount', key: 'termCount', width: 80, render: editableNum('revolvingLoansType1', 'termCount', updateRl1) },
              { title: '还款方式', dataIndex: 'repayMethod', key: 'repayMethod', width: 110, render: editableText('revolvingLoansType1', 'repayMethod', updateRl1) },
              editableStatusColumn('revolvingLoansType1', updateRl1),
              { title: '余额', dataIndex: 'balance', key: 'balance', width: 90, render: editableNum('revolvingLoansType1', 'balance', updateRl1) },
              { title: '剩余期数', dataIndex: 'remainTerms', key: 'remainTerms', width: 80, render: editableNum('revolvingLoansType1', 'remainTerms', updateRl1) },
              { title: '本月应还', dataIndex: 'monthlyPayment', key: 'monthlyPayment', width: 90, render: editableNum('revolvingLoansType1', 'monthlyPayment', updateRl1) },
              { title: '应还款日', dataIndex: 'paymentDueDate', key: 'paymentDueDate', width: 100, render: editableText('revolvingLoansType1', 'paymentDueDate', updateRl1) },
              { title: '本月实还', dataIndex: 'actualPayment', key: 'actualPayment', width: 90, render: editableNum('revolvingLoansType1', 'actualPayment', updateRl1) },
              { title: '逾期期数', dataIndex: 'currentOverdueCount', key: 'currentOverdueCount', width: 80, render: editableNum('revolvingLoansType1', 'currentOverdueCount', updateRl1) },
              { title: '逾期总额', dataIndex: 'currentOverdueAmount', key: 'currentOverdueAmount', width: 90, render: editableNum('revolvingLoansType1', 'currentOverdueAmount', updateRl1) },
            ]}
            size="small"
            pagination={false}
            scroll={{ x: 1600 }}
            sticky
            locale={{ emptyText: '暂无循环贷账户一数据' }}
          />
        </>
      ),
    },
    {
      key: 'revolvingLoan2',
      label: `(三) 循环贷账户二 (${accountCounts.revolvingLoan2})`,
      children: (
        <>
          <Alert title={OCR_TIP} type="info" showIcon style={{ marginBottom: 8 }} />
          <Table
            dataSource={creditDetail.revolvingLoansType2.map((a, i) => ({ ...a, key: i }))}
            columns={[
              { title: '管理机构', dataIndex: 'org', key: 'org', width: 180, fixed: 'left' as const, render: editableText('revolvingLoansType2', 'org', updateRl2) },
              { title: '授信额度', dataIndex: 'creditLimit', key: 'creditLimit', width: 90, render: editableNum('revolvingLoansType2', 'creditLimit', updateRl2) },
              { title: '业务种类', dataIndex: 'businessType', key: 'businessType', width: 130, render: editableText('revolvingLoansType2', 'businessType', updateRl2) },
              { title: '担保方式', dataIndex: 'guaranteeType', key: 'guaranteeType', width: 100, render: editableText('revolvingLoansType2', 'guaranteeType', updateRl2) },
              { title: '还款期数', dataIndex: 'termCount', key: 'termCount', width: 80, render: editableNum('revolvingLoansType2', 'termCount', updateRl2) },
              { title: '还款方式', dataIndex: 'repayMethod', key: 'repayMethod', width: 110, render: editableText('revolvingLoansType2', 'repayMethod', updateRl2) },
              editableStatusColumn('revolvingLoansType2', updateRl2),
              { title: '余额', dataIndex: 'balance', key: 'balance', width: 90, render: editableNum('revolvingLoansType2', 'balance', updateRl2) },
              { title: '剩余期数', dataIndex: 'remainTerms', key: 'remainTerms', width: 80, render: editableNum('revolvingLoansType2', 'remainTerms', updateRl2) },
              { title: '本月应还', dataIndex: 'monthlyPayment', key: 'monthlyPayment', width: 90, render: editableNum('revolvingLoansType2', 'monthlyPayment', updateRl2) },
              { title: '应还款日', dataIndex: 'paymentDueDate', key: 'paymentDueDate', width: 100, render: editableText('revolvingLoansType2', 'paymentDueDate', updateRl2) },
              { title: '本月实还', dataIndex: 'actualPayment', key: 'actualPayment', width: 90, render: editableNum('revolvingLoansType2', 'actualPayment', updateRl2) },
              { title: '逾期期数', dataIndex: 'currentOverdueCount', key: 'currentOverdueCount', width: 80, render: editableNum('revolvingLoansType2', 'currentOverdueCount', updateRl2) },
              { title: '逾期总额', dataIndex: 'currentOverdueAmount', key: 'currentOverdueAmount', width: 90, render: editableNum('revolvingLoansType2', 'currentOverdueAmount', updateRl2) },
            ]}
            size="small"
            pagination={false}
            scroll={{ x: 1600 }}
            sticky
            locale={{ emptyText: '暂无循环贷账户二数据' }}
          />
        </>
      ),
    },
    {
      key: 'creditCard',
      label: `(四) 贷记卡账户 (${accountCounts.creditCard})`,
      children: (
        <>
          <Alert title={OCR_TIP} type="info" showIcon style={{ marginBottom: 8 }} />
          <Table
            dataSource={creditDetail.creditCards.map((a, i) => ({ ...a, key: i }))}
            columns={[
              { title: '发卡机构', dataIndex: 'org', key: 'org', width: 220, fixed: 'left' as const, render: editableText('creditCards', 'org', updateCard) },
              { title: '账户授信额度', dataIndex: 'creditLimit', key: 'creditLimit', width: 120, render: editableNum('creditCards', 'creditLimit', updateCard) },
              editableStatusColumn('creditCards', updateCard),
              { title: '已用额度', dataIndex: 'usedAmount', key: 'usedAmount', width: 120, render: editableNum('creditCards', 'usedAmount', updateCard) },
              { title: '账单日', dataIndex: 'billDate', key: 'billDate', width: 100, render: editableText('creditCards', 'billDate', updateCard) },
              { title: '本月应还', dataIndex: 'monthlyPayment', key: 'monthlyPayment', width: 100, render: editableNum('creditCards', 'monthlyPayment', updateCard) },
              { title: '本月实还', dataIndex: 'actualPayment', key: 'actualPayment', width: 100, render: editableNum('creditCards', 'actualPayment', updateCard) },
              { title: '最近还款日', dataIndex: 'lastPaymentDate', key: 'lastPaymentDate', width: 110, render: editableText('creditCards', 'lastPaymentDate', updateCard) },
            ]}
            size="small"
            pagination={false}
            scroll={{ x: 980 }}
            sticky
            locale={{ emptyText: '暂无贷记卡账户数据' }}
          />
        </>
      ),
    },
    {
      key: 'repayResponsibility',
      label: `(五) 相关还款责任 (${repayResponsibilities.length})`,
      children: (
        <>
          <Alert title={OCR_TIP} type="info" showIcon style={{ marginBottom: 8 }} />
          <Table
            dataSource={repayResponsibilities.map((r, i) => ({ ...r, key: i }))}
            columns={[
              { title: '管理机构', dataIndex: 'org', key: 'org', width: 220, fixed: 'left' as const, render: editableText('repayResponsibilities', 'org', updateRepay) },
              { title: '责任人类型', dataIndex: 'responsibilityType', key: 'responsibilityType', width: 100, render: editableText('repayResponsibilities', 'responsibilityType', updateRepay) },
              { title: '还款责任金额', dataIndex: 'responsibilityAmount', key: 'responsibilityAmount', width: 120, render: editableNum('repayResponsibilities', 'responsibilityAmount', updateRepay) },
              { title: '主业务借款人', dataIndex: 'borrowerName', key: 'borrowerName', width: 120, render: editableText('repayResponsibilities', 'borrowerName', updateRepay) },
              { title: '余额', dataIndex: 'balance', key: 'balance', width: 120, render: editableNum('repayResponsibilities', 'balance', updateRepay) },
            ]}
            size="small"
            pagination={false}
            scroll={{ x: 700 }}
            sticky
            locale={{ emptyText: '暂无相关还款责任数据' }}
          />
        </>
      ),
    },
    {
      key: 'creditAgreement',
      label: `(六) 授信协议信息 (${creditAgreements.length})`,
      children: (
        <>
          <Alert title={OCR_TIP} type="info" showIcon style={{ marginBottom: 8 }} />
          <Table
            dataSource={creditAgreements.map((a, i) => ({ ...a, key: i }))}
            columns={[
              { title: '管理机构', dataIndex: 'org', key: 'org', width: 240, fixed: 'left' as const, render: editableText('creditAgreements', 'org', updateAgreement) },
              { title: '授信额度用途', dataIndex: 'creditPurpose', key: 'creditPurpose', width: 140, render: editableText('creditAgreements', 'creditPurpose', updateAgreement) },
              { title: '授信额度', dataIndex: 'creditLimit', key: 'creditLimit', width: 120, render: editableNum('creditAgreements', 'creditLimit', updateAgreement) },
              { title: '已用额度', dataIndex: 'usedAmount', key: 'usedAmount', width: 120, render: editableNum('creditAgreements', 'usedAmount', updateAgreement) },
            ]}
            size="small"
            pagination={false}
            scroll={{ x: 650 }}
            sticky
            locale={{ emptyText: '暂无授信协议信息' }}
          />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-semibold text-slate-950">章节账户数核对</div>
          <div className="mt-0.5 text-xs text-slate-500">用于复核概要账户数、余额和本月应还是否与明细一致。</div>
        </div>
        <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-4">
          {DERIVED_SUMMARY_ITEMS.map((item) => {
            const summary = accountDerived[item.key] ?? EMPTY_DERIVED_SUMMARY;
            return (
              <div key={item.key} className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-900">{item.label}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <SummaryValue
                    label="机构数"
                    value={summary.orgCount}
                    field={`accountDerived.${item.key}.orgCount`}
                    onChange={(value) => updateDerived(item.key, 'orgCount', value)}
                    reviewProps={reviewProps}
                  />
                  <SummaryValue
                    label="账户数"
                    value={summary.accountCount}
                    field={`accountDerived.${item.key}.accountCount`}
                    onChange={(value) => updateDerived(item.key, 'accountCount', value)}
                    reviewProps={reviewProps}
                  />
                  <SummaryValue
                    label="授信/借款"
                    value={summary.totalCredit}
                    field={`accountDerived.${item.key}.totalCredit`}
                    onChange={(value) => updateDerived(item.key, 'totalCredit', value)}
                    reviewProps={reviewProps}
                  />
                  <SummaryValue
                    label="本月应还"
                    value={summary.monthlyPayment}
                    field={`accountDerived.${item.key}.monthlyPayment`}
                    onChange={(value) => updateDerived(item.key, 'monthlyPayment', value)}
                    reviewProps={reviewProps}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Tabs
        className="mobile-report-tabs"
        items={items}
        size="small"
        tabPosition={tabPosition}
        activeKey={activeSection}
        onChange={(key) => setActiveSection(key as CreditReviewSectionKey)}
      />
    </div>
  );
};

const SummaryValue: React.FC<{
  label: string;
  value: number;
  field: string;
  onChange: (value: number) => void;
  reviewProps: (field: string) => {
    reviewFieldId: string;
    reviewFocused: boolean;
    reviewFocusToken?: number;
  };
}> = ({ label, value, field, onChange, reviewProps }) => (
  <div className="min-w-0">
    <div className="mb-0.5 truncate text-slate-500">{label}</div>
    <EditableCell value={value} type="number" onChange={(next) => onChange(Number(next))} {...reviewProps(field)} />
  </div>
);

export default CreditDetailTab;
