/*
 * @Editor: zhanghang
 * @Description: 
 * @Date: 2026-04-03 15:31:46
 * @LastEditors: zhanghang
 * @LastEditTime: 2026-04-03 15:31:53
 */
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import LeftSidebar from "./LeftSidebar";
import TopHeader from "./TopHeader";
import { IngestionEventProvider } from "../knowledge-base/IngestionEventProvider";

function resolveActiveSection(pathname: string): "chat" | "knowledge" | "settings" {
  if (pathname.startsWith("/knowledge-base")) {
    return "knowledge";
  }
  if (pathname.startsWith("/settings")) {
    return "settings";
  }
  return "chat";
}

const AppShellLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const active = resolveActiveSection(location.pathname);

  return (
    <div className="bg-white font-sans text-[#191c1e]">
      <TopHeader active={active} />
      <LeftSidebar
        active={active}
        onNewChat={() => {
          navigate("/chat", { state: { startNewChatAt: Date.now() } });
        }}
      />
      <IngestionEventProvider>
        <div className="pt-16 md:pl-64">
          <Outlet />
        </div>
      </IngestionEventProvider>
    </div>
  );
};

export default AppShellLayout;