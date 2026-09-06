import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  getModelConfig,
  resetModelConfig,
  updateModelConfig,
  type PublicModelConfig,
} from "../api/modelConfig.api";

type FormState = {
  chatBaseUrl: string;
  chatApiKey: string;
  chatModel: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  chunkSize: string;
  chunkOverlap: string;
  retrievalTopK: string;
  retrievalScoreThreshold: string;
};

const EMPTY_FORM: FormState = {
  chatBaseUrl: "",
  chatApiKey: "",
  chatModel: "",
  embeddingBaseUrl: "",
  embeddingApiKey: "",
  embeddingModel: "",
  chunkSize: "",
  chunkOverlap: "",
  retrievalTopK: "",
  retrievalScoreThreshold: "",
};

/**
 * 模型设置页：为当前账号配置自定义聊天/向量模型凭据。
 * API Key 只显示脱敏摘要，不回显明文；留空表示保留原值，输入新值即覆盖。
 */
const ModelSettingsPage = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saved, setSaved] = useState<PublicModelConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const config = await getModelConfig();
        if (cancelled) return;
        setSaved(config);
        setForm({
          ...EMPTY_FORM,
          chatBaseUrl: config.chatBaseUrl || "",
          chatModel: config.chatModel || "",
          embeddingBaseUrl: config.embeddingBaseUrl || "",
          embeddingModel: config.embeddingModel || "",
          chunkSize: config.chunkSize != null ? String(config.chunkSize) : "",
          chunkOverlap: config.chunkOverlap != null ? String(config.chunkOverlap) : "",
          retrievalTopK: config.retrievalTopK != null ? String(config.retrievalTopK) : "",
          retrievalScoreThreshold: config.retrievalScoreThreshold != null ? String(config.retrievalScoreThreshold) : "",
        });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "加载模型配置失败");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;

    setErrorMessage(null);
    setMessage(null);
    setIsSaving(true);

    try {
      // API Key 输入框留空时不传该字段，后端保留原值；数字参数同理（非法数字视为留空）。
      const chunkSize = Number.parseInt(form.chunkSize, 10);
      const chunkOverlap = Number.parseInt(form.chunkOverlap, 10);
      const retrievalTopK = Number.parseInt(form.retrievalTopK, 10);
      const retrievalScoreThreshold = Number.parseFloat(form.retrievalScoreThreshold);

      const payload = {
        chatBaseUrl: form.chatBaseUrl.trim() || undefined,
        chatApiKey: form.chatApiKey.trim() || undefined,
        chatModel: form.chatModel.trim() || undefined,
        embeddingBaseUrl: form.embeddingBaseUrl.trim() || undefined,
        embeddingApiKey: form.embeddingApiKey.trim() || undefined,
        embeddingModel: form.embeddingModel.trim() || undefined,
        chunkSize: Number.isFinite(chunkSize) ? chunkSize : undefined,
        chunkOverlap: Number.isFinite(chunkOverlap) ? chunkOverlap : undefined,
        retrievalTopK: Number.isFinite(retrievalTopK) ? retrievalTopK : undefined,
        retrievalScoreThreshold: Number.isFinite(retrievalScoreThreshold) ? retrievalScoreThreshold : undefined,
      };

      const config = await updateModelConfig(payload);
      setSaved(config);
      setForm((current) => ({
        ...current,
        chatApiKey: "",
        embeddingApiKey: "",
      }));
      setMessage("配置已保存，之后的对话与文件入库将使用新配置。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    if (!window.confirm("确认清除自定义模型配置吗？清除后将回退到服务端默认配置。")) {
      return;
    }

    setErrorMessage(null);
    setMessage(null);
    setIsSaving(true);

    try {
      await resetModelConfig();
      setSaved(null);
      setForm(EMPTY_FORM);
      setMessage("已恢复服务端默认配置。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "恢复默认失败");
    } finally {
      setIsSaving(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-black focus:ring-1 focus:ring-black disabled:bg-slate-50";
  const sectionTitleClass = "mb-4 text-sm font-semibold text-black";

  function renderSecretField(field: keyof FormState, secret: { configured: boolean; maskedKey: string | null } | undefined, label: string) {
    const isConfigured = Boolean(secret?.configured);
    return (
      <div>
        <label htmlFor={field} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </label>
        {isConfigured ? (
          <input
            id={field}
            type="text"
            value={`已配置（尾号 ${(secret?.maskedKey || "").replace(/^\*+/, "") || "****"}）`}
            disabled
            className={inputClass}
          />
        ) : (
          <input
            id={field}
            type="password"
            autoComplete="off"
            value={form[field]}
            onChange={(event) => updateField(field, event.target.value)}
            placeholder={saved ? "留空保留现有 Key，输入新值覆盖" : "输入 API Key"}
            className={inputClass}
          />
        )}
        {isConfigured && (
          <p className="mt-1 text-xs text-slate-400">出于安全考虑 Key 不可查看；如需更换，请输入新 Key 覆盖。</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-10">
      <div className="mb-8">
        <h1 className="font-headline text-2xl font-bold tracking-tight text-black">模型设置</h1>
        <p className="mt-2 text-sm text-slate-500">
          为当前账号配置自定义模型服务。未填写的项回退到服务端默认配置。
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">正在加载配置…</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-8" noValidate>
          <section className="rounded-xl border border-slate-100 p-6">
            <h2 className={sectionTitleClass}>聊天模型（OpenAI 兼容接口）</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="chatBaseUrl" className="mb-1.5 block text-sm font-medium text-slate-700">接口地址（Base URL）</label>
                <input
                  id="chatBaseUrl"
                  type="text"
                  value={form.chatBaseUrl}
                  onChange={(event) => updateField("chatBaseUrl", event.target.value)}
                  placeholder="例如 https://openrouter.ai/api/v1"
                  className={inputClass}
                />
              </div>
              {renderSecretField("chatApiKey", saved?.chatApiKey, "API Key")}
              <div>
                <label htmlFor="chatModel" className="mb-1.5 block text-sm font-medium text-slate-700">模型名称</label>
                <input
                  id="chatModel"
                  type="text"
                  value={form.chatModel}
                  onChange={(event) => updateField("chatModel", event.target.value)}
                  placeholder="例如 provider/model-name"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-100 p-6">
            <h2 className={sectionTitleClass}>向量模型（Embedding，用于文件入库与检索）</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="embeddingBaseUrl" className="mb-1.5 block text-sm font-medium text-slate-700">接口地址（Base URL）</label>
                <input
                  id="embeddingBaseUrl"
                  type="text"
                  value={form.embeddingBaseUrl}
                  onChange={(event) => updateField("embeddingBaseUrl", event.target.value)}
                  placeholder="留空使用服务端默认端点"
                  className={inputClass}
                />
              </div>
              {renderSecretField("embeddingApiKey", saved?.embeddingApiKey, "API Key")}
              <div>
                <label htmlFor="embeddingModel" className="mb-1.5 block text-sm font-medium text-slate-700">模型名称</label>
                <input
                  id="embeddingModel"
                  type="text"
                  value={form.embeddingModel}
                  onChange={(event) => updateField("embeddingModel", event.target.value)}
                  placeholder="例如 embedding-3"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-100 p-6">
            <h2 className={sectionTitleClass}>检索与入库参数（可选）</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="chunkSize" className="mb-1.5 block text-sm font-medium text-slate-700">分块大小</label>
                <input
                  id="chunkSize"
                  type="number"
                  min={200}
                  max={4000}
                  value={form.chunkSize}
                  onChange={(event) => updateField("chunkSize", event.target.value)}
                  placeholder="默认 800（200-4000）"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="chunkOverlap" className="mb-1.5 block text-sm font-medium text-slate-700">分块重叠</label>
                <input
                  id="chunkOverlap"
                  type="number"
                  min={0}
                  max={1000}
                  value={form.chunkOverlap}
                  onChange={(event) => updateField("chunkOverlap", event.target.value)}
                  placeholder="默认 120（0-1000）"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="retrievalTopK" className="mb-1.5 block text-sm font-medium text-slate-700">检索条数（Top K）</label>
                <input
                  id="retrievalTopK"
                  type="number"
                  min={1}
                  max={20}
                  value={form.retrievalTopK}
                  onChange={(event) => updateField("retrievalTopK", event.target.value)}
                  placeholder="默认 5（1-20）"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="retrievalScoreThreshold" className="mb-1.5 block text-sm font-medium text-slate-700">相关度阈值</label>
                <input
                  id="retrievalScoreThreshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.retrievalScoreThreshold}
                  onChange={(event) => updateField("retrievalScoreThreshold", event.target.value)}
                  placeholder="默认 0.35（0-1）"
                  className={inputClass}
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">分块参数对之后新入库的文件生效；检索参数对之后的提问即时生效。</p>
          </section>

          {errorMessage && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-600">{errorMessage}</p>
          )}
          {message && (
            <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{message}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "保存中…" : "保存配置"}
            </button>
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={isSaving}
              className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="ml-auto text-sm font-medium text-slate-500 transition-colors hover:text-black"
            >
              返回
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ModelSettingsPage;
