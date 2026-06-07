/**
 * API Key 配置弹窗 — 首次启动或用户主动打开时显示
 *
 * 用户输入 TextIn + DeepSeek 的 API Key，保存到主进程持久化存储
 */

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, message, Button, Divider } from 'antd';
import { getPlatformAdapters } from '../platform';

interface SetupModalProps {
  open: boolean;
  onSuccess: () => void;
}

interface KeyFormValues {
  [key: string]: string;
  textinAppId: string;
  textinSecretCode: string;
  deepseekApiKey: string;
}

const SetupModal: React.FC<SetupModalProps> = ({ open, onSuccess }) => {
  const [form] = Form.useForm<KeyFormValues>();
  const platform = getPlatformAdapters();
  const [saving, setSaving] = useState(false);
  const [cacheStats, setCacheStats] = useState<{ count: number; bytes: number }>({ count: 0, bytes: 0 });

  useEffect(() => {
    if (!open) return;
    platform.keyStore.getKeys().then((keys) => {
      form.setFieldsValue({
        textinAppId: keys.textinAppId ?? '',
        textinSecretCode: keys.textinSecretCode ?? '',
        deepseekApiKey: keys.deepseekApiKey ?? '',
      });
    });
    platform.cache.getStats().then(setCacheStats);
  }, [open, form, platform]);

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await platform.keyStore.setKeys(values);
      message.success('API Key 已保存并立即生效');
      onSuccess();
    } catch {
      message.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleClearCache = async () => {
    const removed = await platform.cache.clear();
    setCacheStats({ count: 0, bytes: 0 });
    message.success(`已清理 ${removed} 个 OCR 缓存文件`);
  };

  return (
    <Modal
      title="配置 API Key"
      open={open}
      onOk={handleSave}
      confirmLoading={saving}
      closable={false}
      mask={{ closable: false }}
      okText="保存"
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      <p className="text-gray-500 mb-4 text-sm">
        首次使用需要配置以下 API Key，配置后将安全存储在本地。
      </p>
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item label="TextIn App ID" name="textinAppId"
          rules={[{ required: true, message: '请输入 TextIn App ID' }]}>
          <Input placeholder="TextIn 应用 ID" />
        </Form.Item>
        <Form.Item label="TextIn Secret Code" name="textinSecretCode"
          rules={[{ required: true, message: '请输入 TextIn Secret Code' }]}>
          <Input.Password placeholder="TextIn 密钥" />
        </Form.Item>
        <Form.Item label="DeepSeek API Key" name="deepseekApiKey"
          rules={[{ required: true, message: '请输入 DeepSeek API Key' }]}>
          <Input.Password placeholder="sk-..." />
        </Form.Item>
      </Form>
      <Divider />
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          OCR 缓存：{cacheStats.count} 个文件，{formatBytes(cacheStats.bytes)}
        </div>
        <Button onClick={handleClearCache} disabled={cacheStats.count === 0}>
          清理 OCR 缓存
        </Button>
      </div>
    </Modal>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 / 1024 * 10) / 10} MB`;
}

export default SetupModal;
