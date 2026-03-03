import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { I18nProvider } from "./lib/i18n";
import AppLayout from "./components/AppLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Servers from "./pages/Servers";
import TerminalPage from "./pages/TerminalPage";
import DashboardRouter from "./pages/DashboardRouter";
import SettingsPage from "./pages/SettingsPage";
import RdpPage from "./pages/RdpPage";
import NotFound from "./pages/NotFound";
import SettingsUsersPage from "./pages/SettingsUsersPage";
import SettingsGroupsPage from "./pages/SettingsGroupsPage";
import SettingsPermissionsPage from "./pages/SettingsPermissionsPage";
import AgentsPage from "./pages/AgentsPage";
import AgentRunPage from "./pages/AgentRunPage";
import StudioPage from "./pages/StudioPage";
import PipelineEditorPage from "./pages/PipelineEditorPage";
import PipelineRunsPage from "./pages/PipelineRunsPage";
import AgentConfigPage from "./pages/AgentConfigPage";
import NotificationsSettingsPage from "./pages/NotificationsSettingsPage";
import MCPHubPage from "./pages/MCPHubPage";
import { fetchAuthSession } from "./lib/api";

const queryClient = new QueryClient();

function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: fetchAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!data?.authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <AuthGate>
                <AppLayout />
              </AuthGate>
            }
          >
            <Route path="/" element={<Index />} />
            <Route path="/dashboard" element={<DashboardRouter />} />
            <Route path="/servers" element={<Servers />} />
            <Route path="/servers/hub" element={<TerminalPage />} />
            <Route path="/servers/:id/terminal" element={<TerminalPage />} />
            <Route path="/servers/:id/rdp" element={<RdpPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/run/:runId" element={<AgentRunPage />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/studio/pipeline/:id" element={<PipelineEditorPage />} />
            <Route path="/studio/pipeline/new" element={<PipelineEditorPage />} />
            <Route path="/studio/runs" element={<PipelineRunsPage />} />
            <Route path="/studio/agents" element={<AgentConfigPage />} />
            <Route path="/studio/mcp" element={<MCPHubPage />} />
            <Route path="/studio/notifications" element={<NotificationsSettingsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/users" element={<SettingsUsersPage />} />
            <Route path="/settings/groups" element={<SettingsGroupsPage />} />
            <Route path="/settings/permissions" element={<SettingsPermissionsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
