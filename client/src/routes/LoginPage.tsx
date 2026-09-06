import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/auth/AuthProvider";

type AuthMode = "login" | "register";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * 登录 / 注册页：两种模式共享同一表单，注册时额外校验确认密码。
 * Login & register screen sharing one form; register mode adds password confirmation.
 */
const LoginPage = () => {
  const navigate = useNavigate();
  const { status, login, register } = useAuth();

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      navigate("/chat", { replace: true });
    }
  }, [status, navigate]);

  function validateLocalFields(): string | null {
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 32 || !USERNAME_PATTERN.test(trimmedUsername)) {
      return "用户名需 3-32 个字符，只能使用字母、数字、下划线或中划线。";
    }
    if (password.length < 6) {
      return "密码至少需要 6 个字符。";
    }
    if (mode === "register" && password !== confirmPassword) {
      return "两次输入的密码不一致。";
    }
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const localError = validateLocalFields();
    if (localError) {
      setErrorMessage(localError);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const trimmedUsername = username.trim();
      if (mode === "login") {
        await login(trimmedUsername, password);
      } else {
        await register(trimmedUsername, password);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-black focus:ring-1 focus:ring-black";
  const submitButtonClass = "w-full rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-headline text-2xl font-bold tracking-tight text-black">RAGBox</h1>
          <p className="mt-2 text-sm text-slate-500">本地知识库 RAG 问答</p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-lg border border-slate-200 p-1 text-sm">
          <button
            type="button"
            onClick={() => { setMode("login"); setErrorMessage(null); }}
            className={`rounded-md px-4 py-2 font-medium transition-all ${mode === "login" ? "bg-black text-white" : "text-slate-500 hover:text-black"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setMode("register"); setErrorMessage(null); }}
            className={`rounded-md px-4 py-2 font-medium transition-all ${mode === "register" ? "bg-black text-white" : "text-slate-500 hover:text-black"}`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-slate-700">用户名</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="3-32 个字母、数字、下划线或中划线"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">密码</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 个字符"
              className={inputClass}
            />
          </div>

          {mode === "register" && (
            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-slate-700">确认密码</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入密码"
                className={inputClass}
              />
            </div>
          )}

          {errorMessage && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {errorMessage}
            </p>
          )}

          <button type="submit" disabled={isSubmitting} className={submitButtonClass}>
            {isSubmitting ? "请稍候…" : mode === "login" ? "登录" : "注册账号"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
