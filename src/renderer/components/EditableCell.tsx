import React, { useState, useRef, useEffect } from 'react';
import { InputNumber, Input } from 'antd';

interface EditableCellProps {
  value: string | number | null | undefined;
  type?: 'string' | 'number';
  onChange: (val: any) => void;
  placeholder?: string;
  formatter?: (val: number) => string;
  reviewFieldId?: string;
  reviewFocused?: boolean;
  reviewFocusToken?: number;
}

const EditableCell: React.FC<EditableCellProps> = ({
  value, type, onChange, placeholder = '-', formatter, reviewFieldId, reviewFocused = false, reviewFocusToken,
}) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<any>(null);
  const lastFocusTokenRef = useRef<number | undefined>(undefined);

  const resolvedType = type ?? (typeof value === 'number' ? 'number' : 'string');

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!reviewFocused || !reviewFocusToken || lastFocusTokenRef.current === reviewFocusToken) return;
    lastFocusTokenRef.current = reviewFocusToken;
    setEditing(true);
  }, [reviewFocused, reviewFocusToken]);

  const handleBlur = () => setEditing(false);

  if (editing) {
    if (resolvedType === 'number') {
      return (
        <span id={reviewFieldId} className={buildEditableCellClass(reviewFocused)}>
          <InputNumber
            ref={inputRef}
            size="small"
            value={typeof value === 'number' ? value : undefined}
            onChange={(v) => {
              if (v !== null && v !== undefined) onChange(v);
              else onChange(0);
            }}
            onBlur={handleBlur}
            onPressEnter={handleBlur}
            className="w-full"
          />
        </span>
      );
    }
    return (
      <span id={reviewFieldId} className={buildEditableCellClass(reviewFocused)}>
        <Input
          ref={inputRef}
          size="small"
          value={value?.toString() ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={handleBlur}
          onPressEnter={handleBlur}
        />
      </span>
    );
  }

  const displayValue = formatDisplay(value, resolvedType, formatter, placeholder);

  return (
    <span
      id={reviewFieldId}
      className={buildEditableCellClass(reviewFocused)}
      onClick={() => setEditing(true)}
      title="点击编辑"
    >
      {displayValue}
    </span>
  );
};

function buildEditableCellClass(reviewFocused: boolean): string {
  return [
    'review-editable-cell',
    'cursor-pointer',
    'hover:bg-blue-50',
    'px-1',
    'rounded',
    'min-w-[2em]',
    'inline-block',
    reviewFocused ? 'review-field-target' : '',
  ].filter(Boolean).join(' ');
}

function formatDisplay(
  value: string | number | null | undefined,
  type: string,
  formatter?: (val: number) => string,
  placeholder = '-',
): React.ReactNode {
  if (value === null || value === undefined || value === '') return placeholder;
  if (type === 'number' && typeof value === 'number') {
    return formatter ? formatter(value) : value.toLocaleString('zh-CN');
  }
  return String(value);
}

export default EditableCell;
