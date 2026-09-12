import { Counter, Histogram } from "prom-client";

/**
 * 流式问答链路指标：首字延迟、结局计数、客户端断连。
 * 与 HTTP 通用指标分离，标签与语义专属于 chat 链路。
 */

export const firstToken = new Histogram({
  name: "ragbox_chat_first_token_seconds",
  help: "聊天提问到首个回答分块的延迟（秒）",
  buckets: [0.25, 0.5, 1, 2, 4, 8, 16, 32],
});

export const streams = new Counter({
  name: "ragbox_chat_streams_total",
  help: "流式问答总数（按结局区分）",
  labelNames: ["outcome"] as const,
});

export const clientAborts = new Counter({
  name: "ragbox_chat_client_aborts_total",
  help: "客户端在流式回答期间主动断开的次数",
});
