import ReactMarkdown from 'react-markdown';

/**
 * react-markdown v10 已移除 className 属性，
 * 因此统一通过外层 div 挂载排版样式（见 globals.css 的 .md-body）。
 */
export function Markdown({
  children,
  className = '',
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`md-body ${className}`.trim()}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
