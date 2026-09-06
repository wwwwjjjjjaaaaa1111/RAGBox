import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import MaterialIcon from "../common/MaterialIcon";

type TopHeaderProps = {
  active: "chat" | "knowledge" | "settings";
};

const TopHeader = ({ active }: TopHeaderProps) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const navClass = (isActive: boolean) =>
    isActive
      ? "text-black font-semibold text-sm border-b-2 border-black h-16 flex items-center"
      : "text-slate-400 font-medium text-sm hover:text-black transition-colors h-16 flex items-center";

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="fixed top-0 z-50 flex h-16 w-full items-center justify-between border-b border-slate-100 bg-white/80 px-8 backdrop-blur-md">
      <div className="flex items-center gap-12">
        <span className="font-headline text-lg font-bold tracking-tight text-black">RAGBox</span>
        <nav className="hidden h-full items-center gap-8 md:flex">
          <button
            type="button"
            onClick={() => navigate("/chat")}
            className={navClass(active === "chat")}
          >
            AI 对话
          </button>
          <button
            type="button"
            onClick={() => navigate("/knowledge-base")}
            className={navClass(active === "knowledge")}
          >
            知识库
          </button>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className={navClass(active === "settings")}
          >
            模型设置
          </button>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        {user && (
          <>
            <span className="hidden max-w-[160px] truncate text-sm font-medium text-slate-600 lg:inline">
              {user.username}
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              title="退出登录"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-all hover:bg-slate-50 hover:text-black"
            >
              <MaterialIcon name="logout" className="!text-[18px]" />
            </button>
          </>
        )}
      </div>
    </header>
  );
};

export default TopHeader;
