import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { AUTH_EXPIRED_EVENT } from "../../api/httpClient";
import { fetchCurrentUser, loginUser, logoutSession, registerUser } from "../../api/auth.api";
import type { AuthUser } from "../../workservice/authStorage";
import { clearAuthSession, getAuthToken, getCurrentUser, setAuthSession } from "../../workservice/authStorage";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 全局会话状态提供者：负责 token 校验、登录/注册/登出以及 401 失效后的降级。
 * Provides the session state: token validation on boot, login/register/logout,
 * and graceful degradation when the session expires (401).
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>(() => (getAuthToken() ? "loading" : "anonymous"));
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());
  const [token, setToken] = useState<string | null>(() => getAuthToken());

  // Boot with a stored token: verify it against the backend once.
  useEffect(() => {
    if (status !== "loading") {
      return;
    }

    let cancelled = false;

    async function verifyStoredSession() {
      try {
        const currentUser = await fetchCurrentUser();
        const activeToken = getAuthToken();
        if (cancelled) {
          return;
        }
        if (!activeToken) {
          setUser(null);
          setStatus("anonymous");
          return;
        }
        setUser(currentUser);
        setStatus("authenticated");
      } catch {
        if (!cancelled) {
          clearAuthSession();
          setToken(null);
          setUser(null);
          setStatus("anonymous");
        }
      }
    }

    void verifyStoredSession();

    return () => {
      cancelled = true;
    };
  }, [status]);

  // React to session expiry signaled by the API layer on any 401 response.
  useEffect(() => {
    function handleSessionExpired() {
      setToken(null);
      setUser(null);
      setStatus("anonymous");
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  async function handleLogin(username: string, password: string) {
    const session = await loginUser(username, password);
    setAuthSession(session.token, session.user);
    setToken(session.token);
    setUser(session.user);
    setStatus("authenticated");
  }

  async function handleRegister(username: string, password: string) {
    const session = await registerUser(username, password);
    setAuthSession(session.token, session.user);
    setToken(session.token);
    setUser(session.user);
    setStatus("authenticated");
  }

  async function handleLogout() {
    try {
      await logoutSession();
    } catch {
      // Local session is cleared regardless of the server outcome.
    }
    clearAuthSession();
    setToken(null);
    setUser(null);
    setStatus("anonymous");
  }

  const contextValue = useMemo<AuthContextValue>(() => ({
    status,
    user,
    token,
    login: handleLogin,
    register: handleRegister,
    logout: handleLogout,
  }), [status, user, token]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

/**
 * 受保护路由守卫：未登录时跳转到登录页，会话校验期间展示加载态。
 * Guards protected routes; bounces anonymous users to /login.
 */
export function RequireAuth({ children }: PropsWithChildren) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-black" />
          正在校验会话…
        </div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
