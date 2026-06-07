 import React from 'react';
 import { Descriptions, Card } from 'antd';
 import type { CreditReport, ReportHeader, IdentityInfo } from '../../types/credit-report';
 import EditableCell from '../EditableCell';
 import { buildReviewFieldDomId, type ReviewNavigationTarget } from '../../services/review-navigation';
 import { useReviewFocus } from '../../hooks/useReviewFocus';
 
 interface PersonalInfoTabProps {
   report: CreditReport;
   onChange: (report: CreditReport) => void;
   reviewTarget?: ReviewNavigationTarget;
 }
 
 /** 一、个人基本信息 — 仅保留身份信息 */
 const PersonalInfoTab: React.FC<PersonalInfoTabProps> = ({ report, onChange, reviewTarget }) => {
   const { header, personalInfo } = report;
   const { identity } = personalInfo;
   useReviewFocus(reviewTarget, reviewTarget?.destinationTab === 'personal');
 
   const updateHeader = (key: keyof ReportHeader, val: any) => {
     onChange({ ...report, header: { ...header, [key]: val } });
   };
 
   const updateIdentity = (key: keyof IdentityInfo, val: any) => {
     onChange({
       ...report,
       personalInfo: { ...personalInfo, identity: { ...identity, [key]: val } },
     });
   };

   const reviewProps = (field: string) => {
     const reviewFieldId = buildReviewFieldDomId(field);
     return {
       reviewFieldId,
       reviewFocused: reviewTarget?.anchorId === reviewFieldId,
       reviewFocusToken: reviewTarget?.focusToken,
     };
   };
 
   return (
     <div className="space-y-4">
       <Card title="报告基本信息" size="small">
         <Descriptions column={2} size="small">
           <Descriptions.Item label="报告编号">
             <EditableCell value={header.reportNo} onChange={(v) => updateHeader('reportNo', v)} {...reviewProps('header.reportNo')} />
           </Descriptions.Item>
           <Descriptions.Item label="报告时间">
             <EditableCell value={header.reportTime} onChange={(v) => updateHeader('reportTime', v)} {...reviewProps('header.reportTime')} />
           </Descriptions.Item>
           <Descriptions.Item label="姓名">
             <EditableCell value={header.name} onChange={(v) => updateHeader('name', v)} {...reviewProps('header.name')} />
           </Descriptions.Item>
           <Descriptions.Item label="证件号码">
             <EditableCell value={header.certNo} onChange={(v) => updateHeader('certNo', v)} {...reviewProps('header.certNo')} />
           </Descriptions.Item>
         </Descriptions>
       </Card>
       <Card title="身份信息" size="small">
         <Descriptions column={2} size="small">
           <Descriptions.Item label="性别">
             <EditableCell value={identity.gender} onChange={(v) => updateIdentity('gender', v)} {...reviewProps('personalInfo.identity.gender')} />
           </Descriptions.Item>
           <Descriptions.Item label="出生日期">
             <EditableCell value={identity.birthDate} onChange={(v) => updateIdentity('birthDate', v)} {...reviewProps('personalInfo.identity.birthDate')} />
           </Descriptions.Item>
           <Descriptions.Item label="婚姻状况">
             <EditableCell value={identity.maritalStatus} onChange={(v) => updateIdentity('maritalStatus', v)} {...reviewProps('personalInfo.identity.maritalStatus')} />
           </Descriptions.Item>
           <Descriptions.Item label="就业状况">
             <EditableCell value={identity.employmentStatus} onChange={(v) => updateIdentity('employmentStatus', v)} {...reviewProps('personalInfo.identity.employmentStatus')} />
           </Descriptions.Item>
           <Descriptions.Item label="学历">
             <EditableCell value={identity.education} onChange={(v) => updateIdentity('education', v)} {...reviewProps('personalInfo.identity.education')} />
           </Descriptions.Item>
           <Descriptions.Item label="学位">
             <EditableCell value={identity.degree} onChange={(v) => updateIdentity('degree', v)} {...reviewProps('personalInfo.identity.degree')} />
           </Descriptions.Item>
           <Descriptions.Item label="国籍">
             <EditableCell value={identity.nationality} onChange={(v) => updateIdentity('nationality', v)} {...reviewProps('personalInfo.identity.nationality')} />
           </Descriptions.Item>
           <Descriptions.Item label="电子邮箱">
             <EditableCell value={identity.email} onChange={(v) => updateIdentity('email', v)} {...reviewProps('personalInfo.identity.email')} />
           </Descriptions.Item>
           <Descriptions.Item label="通讯地址" span={2}>
             <EditableCell value={identity.commAddress} onChange={(v) => updateIdentity('commAddress', v)} {...reviewProps('personalInfo.identity.commAddress')} />
           </Descriptions.Item>
           <Descriptions.Item label="户籍地址" span={2}>
             <EditableCell value={identity.registeredAddress} onChange={(v) => updateIdentity('registeredAddress', v)} {...reviewProps('personalInfo.identity.registeredAddress')} />
           </Descriptions.Item>
         </Descriptions>
       </Card>
     </div>
   );
 };
 
 export default PersonalInfoTab;
