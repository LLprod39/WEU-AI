import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
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

function Breadcrumbs() {
  const location = useLocation();
  const { t } = useI18n();
  const segments = location.pathname.split("/").filter(Boolean);

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb">
      <Link to="/" className="hover:text-foreground transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {segments.map((seg, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const i18nKey = routeI18nKeys[seg];
        const label = i18nKey ? t(i18nKey) : seg;
        const isLast = i === segments.length - 1;
        return (
          <span key={path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            {isLast ? (
              <span className="text-foreground font-medium">{label}</span>
            ) : (
              <Link to={path} className="hover:text-foreground transition-colors">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default function AppLayout() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/80 bg-background/90 px-4 backdrop-blur-sm md:px-6">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="min-w-0">
              <div className="enterprise-kicker text-[9px]">Control Plane</div>
              <Breadcrumbs />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
