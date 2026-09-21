// 共享类型定义

export type ComponentType = 'markdown' | 'image' | 'table' | 'echarts' | 'excel_download';

export type OutputComponent = {
  type: ComponentType;
  data: any;
};

/** 响应遥测（P2-1）：命中缓存 / 首 token 耗时 / 总耗时 */
export type Telemetry = {
  cacheHit: boolean;
  ttftMs?: number;
  llmMs?: number;
  totalMs?: number;
};

/** 后端 /api/chat 最终返回的结果结构 */
export type OutputConfig = {
  sql: string;
  title: string;
  summary: string;
  components: OutputComponent[];
  telemetry?: Telemetry;
};

/** 一轮对话（P2-2 多轮上下文用，随请求上传给后端） */
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

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
  /**
   * 用户编辑 SQL 后重新执行的时间戳（未重新执行则无）。
   * 用于在思考过程里标注「模型输出是原始生成、数据已被重新执行覆盖」，
   * 避免用户看到旧的模型输出以为没生效。
   */
  rerunAt?: number;
};

/** 一个会话（多条问答的集合，可独立新建 / 切换 / 删除 / 重命名） */
export type Conversation = {
  id: string;
  title: string;
  turns: Turn[];
  createdAt: number;
  updatedAt: number;
};

/** 用户对某条回答的评价（点赞 / 点踩），按 turnId 记录 */
export type RatingValue = 'up' | 'down';

/** 单条结果的收藏项（Phase 1 仅本地存储；Phase 2 接入云端后可用于跨端查看与跳回原会话） */
export type FavoriteItem = {
  id: string;
  turnId: string;
  conversationId: string;
  title: string;
  sql: string;
  summary: string;
  createdAt: number;
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
