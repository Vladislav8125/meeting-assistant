import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { ClipboardCheck, Layers, Mic, BookOpen, LogOut, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { to: "/app/checklist", label: "1 · Чек-лист", icon: ClipboardCheck },
  { to: "/app/matrix",    label: "2 · Матрица подготовки", icon: Layers },
  { to: "/app/meeting",   label: "3 · Запись и анализ", icon: Mic },
] as const;

const journal = { to: "/app/journal", label: "Все совещания", icon: BookOpen };

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/app/checklist" className="flex items-center gap-2 px-2 py-1">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand to-accent-2 shadow-glow shrink-0" />
          {!collapsed && <span className="font-display text-base font-semibold">meetanalize</span>}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Стадии</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => (
                <SidebarMenuItem key={it.to}>
                  <SidebarMenuButton asChild isActive={isActive(it.to)}>
                    <Link to={it.to} className="flex items-center gap-2">
                      <it.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{it.label}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Архив</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive(journal.to)}>
                  <Link to={journal.to} className="flex items-center gap-2">
                    <journal.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>{journal.label}</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {!collapsed && (
          <div className="px-2 pb-1 text-[11px] font-mono text-muted-foreground flex items-center gap-1 truncate">
            <Sparkles className="h-3 w-3 text-accent-2 shrink-0" />
            <span className="truncate">{email}</span>
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout}>
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Выйти</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
