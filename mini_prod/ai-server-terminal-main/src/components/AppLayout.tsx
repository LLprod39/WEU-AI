import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { ArrowLeft, ChevronRight, Home } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";

const routeI18nKeys: Record<string, string> = {
  dashboard: "bc.dashboard",
  servers: "bc.servers",
  settings: "bc.settings",
  terminal: "bc.terminal",
  hub: "bc.hub",
  rdp: "bc.rdp",
  users: "bc.users",
  groups: "bc.groups",
  permissions: "bc.permissions",
};

const immersiveMeta: Array<{ match: RegExp; title: string; subtitle: string; backTo: string }> = [
  { match: /^\/servers\/hub$/, title: "Terminal Hub", subtitle: "Multi-server terminal workspace", backTo: "/servers" },
  { match: /^\/servers\/\d+\/terminal$/, title: "Terminal", subtitle: "Full-width live server terminal", backTo: "/servers" },
  { match: /^\/servers\/\d+\/rdp$/, title: "RDP", subtitle: "Remote desktop workspace", backTo: "/servers" },
  { match: /^\/agents\/run\/\d+$/, title: "Agent Run", subtitle: "Live execution and operator review", backTo: "/agents" },
  { match: /^\/studio\/pipeline\/(?:new|\d+)$/, title: "Pipeline Editor", subtitle: "Focused pipeline workspace", backTo: "/studio" },
];

function Breadcrumbs() {
  const location = useLocation();
  const { t } = useI18n();
  const segments = location.pathname.split("/").filter(Boolean);

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb">
      <Link to="/" className="transition-colors hover:text-foreground">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {segments.map((segment, index) => {
        const path = "/" + segments.slice(0, index + 1).join("/");
        const key = routeI18nKeys[segment];
        const label = key ? t(key) : segment;
        const isLast = index === segments.length - 1;

        return (
          <span key={path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            {isLast ? (
              <span className="font-medium text-foreground">{label}</span>
            ) : (
              <Link to={path} className="transition-colors hover:text-foreground">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function ImmersiveHeader({
  title,
  subtitle,
  backTo,
}: {
  title: string;
  subtitle: string;
  backTo: string;
}) {
  return (
    <header className="h-14 border-b border-border bg-card/50">
      <div className="flex h-full items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to={backTo}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
            <div className="hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const immersive = immersiveMeta.find((item) => item.match.test(location.pathname)) ?? null;

  return (
    <SidebarProvider defaultOpen={!immersive}>
      <div className="flex min-h-screen w-full bg-background">
        {!immersive ? <AppSidebar /> : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {immersive ? (
            <ImmersiveHeader title={immersive.title} subtitle={immersive.subtitle} backTo={immersive.backTo} />
          ) : (
            <header className="flex h-14 items-center gap-4 border-b border-border bg-card/50 px-4">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              <Breadcrumbs />
            </header>
          )}

          <main className={immersive ? "flex-1 overflow-hidden" : "flex-1 overflow-auto"}>
            {immersive ? (
              <Outlet />
            ) : (
              <div className="workspace-frame">
                <Outlet />
              </div>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
