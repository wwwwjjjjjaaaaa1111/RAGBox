import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 请求级上下文：让任意深层（如 ai.service 的请求头工厂）拿到当前 requestId，
 * 而无需把 req 对象层层透传。ALS 保证 async 链路（await、回调）中不串号。
 */

export type RequestContext = {
  requestId: string;
};

export const aiRequestStorage = new AsyncLocalStorage<RequestContext>();
