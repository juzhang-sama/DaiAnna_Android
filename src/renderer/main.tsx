import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#0f766e',
          colorInfo: '#2563eb',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          borderRadius: 6,
          borderRadiusLG: 8,
          colorBgLayout: '#eef2f7',
          colorText: '#0f172a',
          colorTextSecondary: '#64748b',
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: {
            controlHeight: 36,
            controlHeightLG: 44,
            fontWeight: 600,
            primaryShadow: 'none',
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#334155',
            rowHoverBg: '#f8fafc',
          },
          Tag: {
            borderRadiusSM: 6,
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
);

