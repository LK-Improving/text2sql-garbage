// 共享类型定义

export type ComponentType = 'markdown' | 'table' | 'echarts' | 'excel_download';

export type OutputComponent = {
  type: ComponentType;
  data: any;
};

/** 后端 /api/chat 最终返回的结果结构 */
export type OutputConfig = {
  sql: string;
  title: string;
  summary: string;
  components: OutputComponent[];
};

/** 一轮问答 */
export type Turn = {
  id: string;
  question: string;
  /** LLM 原始流式输出（增量拼接） */
  stream: string;
  result: OutputConfig | null;
  error: string | null;
  status: 'streaming' | 'done' | 'error';
  startedAt: number;
};

export type ResultTab = 'overview' | 'sql' | 'table' | 'chart';

export type TableColumn = { field: string; label: string };
export type TableData = { columns: TableColumn[]; rows: Record<string, any>[] };

export type ChartPoint = { label: string; value: number };

/** 图表形态 */
export type ChartType = 'bar' | 'line' | 'pie';

/** 点击暂未开放的功能时的提示 */
export type UnavailableHandler = (feature: string) => void;

/** 顶部轻提示（已实现功能的反馈走这里，区别于「暂未开放」） */
export type NotifyHandler = (message: string) => void;
