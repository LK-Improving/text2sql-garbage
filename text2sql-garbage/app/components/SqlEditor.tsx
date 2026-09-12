'use client';

// Monaco SQL 编辑器（FR7）。
// 用 next/dynamic + ssr:false 延迟到浏览器端加载：Monaco 依赖 window，
// 服务端渲染会报错，必须客户端挂载后再加载。

import dynamic from 'next/dynamic';

const MonacoEditor = dynamic(() => import('@monaco-editor/react').then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="flex h-[260px] items-center justify-center bg-[#0f172a] text-[12px] text-[#8ba0bd]">
      编辑器加载中…
    </div>
  ),
});

export function SqlEditor({
  value,
  onChange,
  readOnly = false,
  height = 260,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-line"
      style={{ height }}
    >
      <MonacoEditor
        height="100%"
        language="sql"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          renderLineHighlight: 'line',
          padding: { top: 8, bottom: 8 },
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
    </div>
  );
}
