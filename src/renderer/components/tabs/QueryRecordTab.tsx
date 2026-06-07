import React, { useEffect, useMemo, useState } from 'react';
import { Grid, Table, Tabs } from 'antd';
import type { CreditReport } from '../../types/credit-report';
import { buildReviewFieldDomId, type ReviewNavigationTarget } from '../../services/review-navigation';
import { useReviewFocus } from '../../hooks/useReviewFocus';

interface QueryRecordTabProps {
  report: CreditReport;
  onChange: (report: CreditReport) => void;
  reviewTarget?: ReviewNavigationTarget;
}

/**
 * 四、查询记录
 * 包含二级章节：机构查询记录明细、本人查询记录明细
 */
const QueryRecordTab: React.FC<QueryRecordTabProps> = ({ report, reviewTarget }) => {
  const screens = Grid.useBreakpoint();
  const tabPosition = screens.md ? 'left' : 'top';
  const { orgQueries, selfQueries } = report.queryRecord;
  const [activeSection, setActiveSection] = useState<'orgQuery' | 'selfQuery'>('orgQuery');
  useReviewFocus(reviewTarget, reviewTarget?.destinationTab === 'query');

  useEffect(() => {
    if (reviewTarget?.destinationTab !== 'query' || !reviewTarget.querySectionKey) return;
    setActiveSection(reviewTarget.querySectionKey);
  }, [reviewTarget?.destinationTab, reviewTarget?.focusToken, reviewTarget?.querySectionKey]);

  // 提取所有不重复的查询原因，用于 filter
  const reasonFilters = useMemo(() => {
    const reasons = new Set(orgQueries.map(q => q.queryReason).filter(Boolean));
    return Array.from(reasons).map(r => ({ text: r, value: r }));
  }, [orgQueries]);

  const reviewSpan = (field: string, value: React.ReactNode) => {
    const reviewFieldId = buildReviewFieldDomId(field);
    const focused = reviewTarget?.anchorId === reviewFieldId;
    return (
      <span id={reviewFieldId} className={focused ? 'review-field-target' : undefined}>
        {value || '-'}
      </span>
    );
  };

  const items = [
    {
      key: 'orgQuery',
      label: `(一) 机构查询记录明细 (${orgQueries.length})`,
      children: (
        <Table
          dataSource={orgQueries.map((q, i) => ({ ...q, key: i }))}
          columns={[
            {
              title: '查询日期',
              dataIndex: 'queryDate',
              key: 'queryDate',
              width: 130,
              render: (value: string, row: any) => reviewSpan(`queryRecord.orgQueries[${row.key}].queryDate`, value),
            },
            {
              title: '查询机构',
              dataIndex: 'queryOrg',
              key: 'queryOrg',
              render: (value: string, row: any) => reviewSpan(`queryRecord.orgQueries[${row.key}].queryOrg`, value),
            },
            {
              title: '查询原因', dataIndex: 'queryReason', key: 'queryReason', width: 150,
              filters: reasonFilters,
              onFilter: (value: React.Key | boolean, record: { queryReason: string }) =>
                record.queryReason === String(value),
              render: (value: string, row: any) => reviewSpan(`queryRecord.orgQueries[${row.key}].queryReason`, value),
            },
          ]}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 600 }}
          locale={{ emptyText: '暂无机构查询记录' }}
        />
      ),
    },
    {
      key: 'selfQuery',
      label: `(二) 本人查询记录明细 (${selfQueries.length})`,
      children: (
        <Table
          dataSource={selfQueries.map((q, i) => ({ ...q, key: i }))}
          columns={[
            {
              title: '查询日期',
              dataIndex: 'queryDate',
              key: 'queryDate',
              width: 120,
              render: (value: string, row: any) => reviewSpan(`queryRecord.selfQueries[${row.key}].queryDate`, value),
            },
            {
              title: '查询机构',
              dataIndex: 'queryOrg',
              key: 'queryOrg',
              render: (value: string, row: any) => reviewSpan(`queryRecord.selfQueries[${row.key}].queryOrg`, value),
            },
            {
              title: '查询原因',
              dataIndex: 'queryReason',
              key: 'queryReason',
              width: 150,
              render: (value: string, row: any) => reviewSpan(`queryRecord.selfQueries[${row.key}].queryReason`, value),
            },
          ]}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 600 }}
          locale={{ emptyText: '暂无本人查询记录' }}
        />
      ),
    },
  ];

  return (
    <Tabs
      className="mobile-report-tabs"
      items={items}
      size="small"
      tabPosition={tabPosition}
      activeKey={activeSection}
      onChange={(key) => setActiveSection(key as 'orgQuery' | 'selfQuery')}
    />
  );
};

export default QueryRecordTab;
