import { LayoutDashboard, Server, Settings, LogOut, Terminal, Bot, Workflow, Wrench, Orbit } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { authLogout, fetchAuthSession } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { lang, setLang, t } = useI18n();
  const { data } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: fetchAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  const navSections = [
    {
      id: "operate",
      label: "Operate",
      items: [
        { titleKey: "nav.dashboard", url: "/dashboard", icon: LayoutDashboard },
        { titleKey: "nav.servers", url: "/servers", icon: Server },
        { titleKey: "nav.agents", url: "/agents", icon: Bot },
      ],
    },
    {
      id: "build",
      label: "Build",
      items: [
        { titleKey: "nav.studio", url: "/studio", icon: Workflow },
        { titleKey: "nav.settings", url: "/settings", icon: Settings },
      ],
    },
  ];

  const isAllowed = (url: string) => {
    if (url === "/dashboard") return data?.user?.features?.dashboard;
    if (url === "/agents") return data?.user?.features?.agents;
    if (url === "/studio") return data?.user?.features?.studio;
    if (url === "/settings") return data?.user?.features?.settings;
    return url === "/servers";
  };

  const allowedSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isAllowed(item.url)),
    }))
    .filter((section) => section.items.length > 0);

  const handleLogout = async () => {
    await authLogout();
    await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    navigate("/login", { replace: true });
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar-accent">
          <Orbit className="h-4.5 w-4.5 text-sidebar-primary shrink-0" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">Enterprise Control Plane</p>
            <span className="block text-sm font-semibold text-foreground">WebTerm AI</span>
          </div>
        )}
      </div>

      <SidebarContent className="pt-3">
        {allowedSections.map((section) => (
          <SidebarGroup key={section.id} className="px-1.5">
            {!collapsed && (
              <SidebarGroupLabel className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.titleKey}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/dashboard"}
                        className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        activeClassName="border-sidebar-border bg-sidebar-accent text-sidebar-primary font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{t(item.titleKey)}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {!collapsed && (
          <div className="mx-3 mt-4 rounded-xl border border-sidebar-border bg-sidebar-accent/70 p-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-semibold text-foreground">Runtime vs Build</p>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Agents is the live execution fleet. Studio is the builder layer for configs, skills, MCP, pipelines, and runs.
            </p>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2.5 space-y-2.5">
        {!collapsed && (
          <div className="flex">
            <div className="inline-flex w-full overflow-hidden rounded-xl border border-sidebar-border bg-sidebar-accent text-[11px] font-semibold">
              <button
                onClick={() => setLang("en")}
                className={`flex-1 px-3 py-1.5 transition-colors ${lang === "en" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                EN
              </button>
              <button
                onClick={() => setLang("ru")}
                className={`flex-1 px-3 py-1.5 transition-colors ${lang === "ru" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                RU
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            {(data?.user?.username || "U").slice(0, 1).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{data?.user?.username || "user"}</p>
              <p className="text-[11px] text-muted-foreground">
                {data?.user?.is_staff ? t("nav.admin") : t("nav.operator")}
              </p>
            </div>
          )}
          {!collapsed && (
            <button
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={t("nav.signout")}
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
