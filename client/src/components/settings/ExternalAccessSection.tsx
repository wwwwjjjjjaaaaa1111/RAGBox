import { useEffect, useState } from "react";
import {
  createAccessToken,
  listAccessTokens,
  revokeAccessToken,
  type AccessTokenScope,
  type AccessTokenSummary,
  type CreatedAccessToken,
} from "../../api/personalAccessToken.api";
import MaterialIcon from "../common/MaterialIcon";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-black focus:ring-1 focus:ring-black disabled:bg-slate-50";
const sectionTitleClass = "mb-1 text-sm font-semibold text-black";

/** 可勾选的权限，文案面向用户而不是直接暴露 scope 字面量。 */
const SCOPE_OPTIONS: Array<{ value: AccessTokenScope; label: string; hint: string }> = [
  { value: "kb:read", label: "读取知识库", hint: "检索知识库、查看文件与分块" },
  { value: "chat:write", label: "对话访问", hint: "读取会话历史、发问并写入新消息" },
  { value: "charts:generate", label: "生成图表", hint: "按给定数据生成图表图片" },
];

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatLastUsed(value: string | null): string {
  if (!value) {
    return "从未使用";
  }

  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return formatDate(value);
}

function isExpired(value: string): boolean {
  return new Date(value).getTime() <= Date.now();
}

/**
 * 「外部接入」区块：管理供 MCP 等外部客户端使用的个人访问令牌。
 * 明文只在签发时展示一次，之后仅能查看摘要；如需更换只能重新签发。
 */
const ExternalAccessSection = () => {
  const [tokens, setTokens] = useState<AccessTokenSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AccessTokenScope[]>(["kb:read"]);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<CreatedAccessToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await listAccessTokens();
        if (!cancelled) {
          setTokens(list);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "加载令牌列表失败");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleScope(scope: AccessTokenScope) {
    setScopes((current) => (
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope]
    ));
  }

  async function handleCreate() {
    if (isCreating) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage("请先填写令牌名称，方便日后辨认用途。");
      return;
    }
    if (scopes.length === 0) {
      setErrorMessage("请至少勾选一项权限。");
      return;
    }

    setErrorMessage(null);
    setMessage(null);
    setIsCreating(true);

    try {
      const created = await createAccessToken({ name: trimmedName, scopes });
      setCreatedToken(created);
      setTokens((current) => [created, ...current]);
      setName("");
      setCopied(false);
      setMessage(`已创建令牌「${created.name}」，请立即复制保存。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建令牌失败");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopy() {
    if (!createdToken) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdToken.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setErrorMessage("复制失败，请手动选中令牌文本复制。");
    }
  }

  async function handleRevoke(token: AccessTokenSummary) {
    if (!window.confirm(`确认吊销令牌「${token.name}」吗？使用该令牌的客户端将立即失效。`)) {
      return;
    }

    setErrorMessage(null);
    setMessage(null);
    setRevokingId(token.id);

    try {
      await revokeAccessToken(token.id);
      setTokens((current) => current.filter((item) => item.id !== token.id));
      if (createdToken?.id === token.id) {
        setCreatedToken(null);
      }
      setMessage(`已吊销令牌「${token.name}」。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "吊销令牌失败");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-100 p-6">
      <h2 className={sectionTitleClass}>外部接入（MCP）</h2>
      <p className="mb-4 text-xs text-slate-500">
        生成个人访问令牌，供 Claude Desktop、ZCode、Cursor 等 MCP 客户端访问本知识库。
        令牌等同于你的身份，请妥善保管，不要提交到代码仓库。
      </p>

      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="tokenName" className="mb-1.5 block text-sm font-medium text-slate-700">
            令牌名称
          </label>
          <input
            id="tokenName"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：Claude Desktop 本机"
            className={inputClass}
            disabled={isCreating}
          />
        </div>

        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-slate-700">权限</legend>
          <div className="flex flex-col gap-2">
            {SCOPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-100 px-3 py-2 transition-colors hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(option.value)}
                  onChange={() => toggleScope(option.value)}
                  disabled={isCreating}
                  className="mt-0.5 h-4 w-4 accent-black"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-slate-800">{option.label}</span>
                  <span className="text-xs text-slate-400">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={isCreating}
            className="rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? "生成中…" : "生成令牌"}
          </button>
        </div>
      </div>

      {createdToken && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <MaterialIcon name="warning" className="!text-[16px]" />
            请立即复制：此令牌只显示这一次
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={createdToken.token}
              onFocus={(event) => event.currentTarget.select()}
              className={`${inputClass} font-mono !text-xs`}
            />
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-black hover:text-black"
            >
              <MaterialIcon name={copied ? "check" : "content_copy"} className="!text-[16px]" />
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <p className="mt-2 text-xs text-amber-700">
            刷新页面后将无法再次查看；若丢失，请吊销后重新生成。
          </p>
        </div>
      )}

      <div className="mt-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          已签发的令牌
        </h3>

        {isLoading ? (
          <p className="py-4 text-sm text-slate-400">正在加载…</p>
        ) : tokens.length === 0 ? (
          <p className="py-4 text-sm text-slate-400">还没有令牌。生成一个即可在 MCP 客户端中使用。</p>
        ) : (
          <ul className="divide-y divide-slate-50 border-t border-slate-100">
            {tokens.map((token) => (
              <li key={token.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-black">{token.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {token.scopes.join(" · ")}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    创建于 {formatDate(token.createdAt)}｜使用：{formatLastUsed(token.lastUsedAt)}｜
                    {isExpired(token.expiresAt)
                      ? <span className="text-rose-500">已过期</span>
                      : `有效期至 ${formatDate(token.expiresAt)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(token)}
                  disabled={revokingId === token.id}
                  className="shrink-0 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-400 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {revokingId === token.id ? "吊销中…" : "吊销"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {errorMessage && (
        <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          {errorMessage}
        </p>
      )}
      {message && (
        <p className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          {message}
        </p>
      )}
    </section>
  );
};

export default ExternalAccessSection;
