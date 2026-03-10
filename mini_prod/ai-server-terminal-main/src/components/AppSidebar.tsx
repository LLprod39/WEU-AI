import { LayoutDashboard, Server, Settings, LogOut, Terminal, Bot, Workflow } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
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

  const navItems = [
    { titleKey: "nav.dashboard", url: "/dashboard", icon: LayoutDashboard },
    { titleKey: "nav.servers", url: "/servers", icon: Server },
    { titleKey: "nav.agents", url: "/agents", icon: Bot },
    { titleKey: "nav.studio", url: "/studio", icon: Workflow },
    { titleKey: "nav.settings", url: "/settings", icon: Settings },
  ];

  const allowedItems = navItems.filter((item) => {
    if (item.url === "/dashboard") return data?.user?.features?.dashboard;
    if (item.url === "/agents") return data?.user?.features?.agents;
    if (item.url === "/studio") return data?.user?.features?.studio;
    if (item.url === "/settings") return data?.user?.features?.settings;
    return item.url === "/servers";
  });

  const handleLogout = async () => {
    await authLogout();
    await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    navigate("/login", { replace: true });
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Terminal className="h-5 w-5 shrink-0 text-primary" />
        {!collapsed && (
          <span className="font-semibold tracking-tight text-foreground">
            WebTerm<span className="text-primary">AI</span>
          </span>
        )}
      </div>

      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {allowedItems.map((item) => (
                <SidebarMenuItem key={item.titleKey}>
                  <SidebarMenuButton asChild tooltip={t(item.titleKey)}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
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
      </SidebarContent>

      <SidebarFooter className="space-y-3 border-t border-border p-3">
        {!collapsed && (
          <div className="flex justify-center">
            <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px] font-semibold">
              <button
                onClick={() => setLang("en")}
                className={`px-2.5 py-1 transition-colors ${lang === "en" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                EN
              </button>
              <button
                onClick={() => setLang("ru")}
                className={`px-2.5 py-1 transition-colors ${lang === "ru" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                RU
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            {(data?.user?.username || "U").slice(0, 1).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{data?.user?.username || "user"}</p>
              <p className="text-xs text-muted-foreground">
                {data?.user?.is_staff ? t("nav.admin") : t("nav.operator")}
              </p>
            </div>
          )}
          {!collapsed && (
            <button
              className="text-muted-foreground transition-colors hover:text-destructive"
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
