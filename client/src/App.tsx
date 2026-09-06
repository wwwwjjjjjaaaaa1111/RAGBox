import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, RequireAuth } from "./components/auth/AuthProvider";
import AppShellLayout from "./components/layout/AppShellLayout";
import ChatPage from "./routes/ChatPage";
import KnowledgeBasePage from "./routes/KnowledgeBasePage";
import KnowledgeFileDetailPage from "./routes/KnowledgeFileDetailPage";
import LoginPage from "./routes/LoginPage";
import ModelSettingsPage from "./routes/ModelSettingsPage";

const App = () => {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={(
            <RequireAuth>
              <AppShellLayout />
            </RequireAuth>
          )}
        >
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="knowledge-base" element={<KnowledgeBasePage />} />
          <Route path="knowledge-base/files/:fileId" element={<KnowledgeFileDetailPage />} />
          <Route path="settings" element={<ModelSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
};

export default App;
