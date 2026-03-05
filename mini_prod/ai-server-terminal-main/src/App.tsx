import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, type ReactNode } from "react";
import { I18nProvider, useI18n } from "./lib/i18n";
import AppLayout from "./components/AppLayout";
import { fetchAuthSession } from "./lib/api";

const queryClient = new QueryClient();
const Index = lazy(() => import("./pages/Index"));
const Login = lazy(() => import("./pages/Login"));
const Servers = lazy(() => import("./pages/Servers"));
const TerminalPage = lazy(() => import("./pages/TerminalPage"));
const DashboardRouter = lazy(() => import("./pages/DashboardRouter"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const RdpPage = lazy(() => import("./pages/RdpPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SettingsUsersPage = lazy(() => import("./pages/SettingsUsersPage"));
const SettingsGroupsPage = lazy(() => import("./pages/SettingsGroupsPage"));
const SettingsPermissionsPage = lazy(() => import("./pages/SettingsPermissionsPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const AgentRunPage = lazy(() => import("./pages/AgentRunPage"));
const StudioPage = lazy(() => import("./pages/StudioPage"));
const PipelineEditorPage = lazy(() => import("./pages/PipelineEditorPage"));
const PipelineRunsPage = lazy(() => import("./pages/PipelineRunsPage"));
const AgentConfigPage = lazy(() => import("./pages/AgentConfigPage"));
const StudioSkillsPage = lazy(() => import("./pages/StudioSkillsPage"));
const NotificationsSettingsPage = lazy(() => import("./pages/NotificationsSettingsPage"));
const MCPHubPage = lazy(() => import("./pages/MCPHubPage"));

function RouteLoader() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="enterprise-panel flex min-w-[260px] items-center gap-3 rounded-xl px-4 py-3 text-sm text-muted-foreground">
        <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
        {t("app.loading_workspace")}
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: fetchAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        {t("loading")}
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
          <Suspense fallback={<RouteLoader />}>
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
                <Route path="/studio/skills" element={<StudioSkillsPage />} />
                <Route path="/studio/mcp" element={<MCPHubPage />} />
                <Route path="/studio/notifications" element={<NotificationsSettingsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/users" element={<SettingsUsersPage />} />
                <Route path="/settings/groups" element={<SettingsGroupsPage />} />
                <Route path="/settings/permissions" element={<SettingsPermissionsPage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
