import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAccessUser,
  deleteAccessUser,
  fetchAccessGroups,
  fetchAccessUsers,
  setAccessUserPassword,
  updateAccessUser,
  type AccessUser,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MetricCard, MetricGrid, PageHero, PageShell, SectionCard } from "@/components/ui/page-shell";
import { KeyRound, RefreshCw, Shield, UserCog, UserPlus, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type UserForm = ReturnType<typeof emptyForm>;
type EditingState = {
  username?: string;
  email?: string;
  is_staff?: boolean;
  is_active?: boolean;
  access_profile?: string;
  groups?: number[];
};

function emptyForm() {
  return {
    username: "",
    email: "",
    password: "",
    is_staff: false,
    is_active: true,
    access_profile: "server_only",
    groups: [] as number[],
  };
}

function toggleGroup(source: number[], id: number) {
  if (source.includes(id)) return source.filter((x) => x !== id);
  return [...source, id];
}

function profileLabel(value: string | undefined, lang: "ru" | "en") {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  if (value === "server_only") return tr("Только серверы", "Server only");
  if (value === "admin_full") return tr("Полный админ", "Admin full");
  if (value === "reset_defaults") return tr("Сброс по умолчанию", "Reset defaults");
  return tr("Кастом", "Custom");
}

export default function SettingsUsersPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UserForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditingState>({});
  const [search, setSearch] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<AccessUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AccessUser | null>(null);

  const { data: usersData, isLoading, error } = useQuery({ queryKey: ["access", "users"], queryFn: fetchAccessUsers });
  const { data: groupsData } = useQuery({ queryKey: ["access", "groups"], queryFn: fetchAccessGroups });

  const users = usersData?.users || [];
  const groups = groupsData?.groups || [];
  const filteredUsers = users.filter((user) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return user.username.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
  });

  const selectedGroupsLabel = useMemo(() => {
    const selected = groups.filter((group) => form.groups.includes(group.id));
    return selected.map((group) => group.name).join(", ");
  }, [form.groups, groups]);

  const activeUsers = users.filter((user) => user.is_active).length;
  const staffUsers = users.filter((user) => user.is_staff).length;
  const privilegedUsers = users.filter((user) => user.access_profile === "admin_full" || user.is_superuser).length;

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ["access", "users"] });
    await queryClient.invalidateQueries({ queryKey: ["access", "groups"] });
  };

  const onCreate = async () => {
    setSaving(true);
    try {
      await createAccessUser(form);
      setForm(emptyForm());
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (user: AccessUser) => {
    setEditingId(user.id);
    setEditing({
      username: user.username,
      email: user.email,
      is_staff: user.is_staff,
      is_active: user.is_active,
      access_profile: user.access_profile || "custom",
      groups: (user.groups || []).map((group) => group.id),
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await updateAccessUser(editingId, editing);
    setEditingId(null);
    setEditing({});
    await reload();
  };

  const removeUser = async (user: AccessUser) => {
    await deleteAccessUser(user.id);
    await reload();
  };

  const savePassword = async () => {
    if (!passwordTarget || !newPassword.trim()) return;
    setPasswordSaving(true);
    try {
      await setAccessUserPassword(passwordTarget.id, newPassword.trim());
      setPasswordTarget(null);
      setNewPassword("");
    } finally {
      setPasswordSaving(false);
    }
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{tr("Загрузка пользователей...", "Loading users...")}</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{tr("Не удалось загрузить пользователей.", "Failed to load users.")}</div>;

  return (
    <PageShell width="6xl">
      <PageHero
        kicker={tr("Управление доступом", "Access Control")}
        title={tr("Пользователи", "Users")}
        description={tr(
          "Создавайте учетные записи операторов, назначайте профили по умолчанию и управляйте статусом аккаунтов.",
          "Create operator accounts, attach default profiles and adjust account state.",
        )}
        actions={(
          <Button size="sm" variant="outline" className="gap-2" onClick={reload}>
            <RefreshCw className="h-4 w-4" />
            {tr("Обновить список", "Refresh directory")}
          </Button>
        )}
      >
        <MetricGrid>
          <MetricCard label={tr("Всего пользователей", "Total users")} value={users.length} description={tr("Аккаунты, зарегистрированные в платформе.", "Accounts currently known to the platform.")} icon={<Users className="h-5 w-5 text-primary" />} />
          <MetricCard label={tr("Активные", "Active")} value={activeUsers} description={tr("Аккаунты, которые могут войти прямо сейчас.", "Accounts that can sign in right now.")} icon={<UserCog className="h-5 w-5 text-emerald-400" />} />
          <MetricCard label={tr("Сотрудники", "Staff")} value={staffUsers} description={tr("Пользователи с расширенными правами администратора.", "Users with elevated backend/admin capabilities.")} icon={<Shield className="h-5 w-5 text-amber-300" />} />
          <MetricCard label={tr("Привилегированные", "Privileged")} value={privilegedUsers} description={tr("Пользователи с административными профилями доступа.", "Users pinned to full-access administrative profiles.")} icon={<KeyRound className="h-5 w-5 text-violet-300" />} />
        </MetricGrid>
      </PageHero>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <SectionCard
            title={tr("Каталог пользователей", "User directory")}
            description={tr("Поиск, редактирование и обслуживание учетных записей пользователей.", "Search, edit and maintain account access.")}
            actions={(
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tr("Поиск по логину или email", "Search by username or email")}
                className="w-full sm:w-72"
              />
            )}
          >
            <div className="space-y-3">
              {filteredUsers.map((user) => {
                const isEditing = editingId === user.id;
                const currentGroups = isEditing ? editing.groups || [] : (user.groups || []).map((group) => group.id);
                return (
                  <div key={user.id} className="rounded-2xl border border-border/70 bg-background/30 px-4 py-4">
                    {!isEditing ? (
                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-semibold text-foreground">{user.username}</span>
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${user.is_active ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                                {user.is_active ? tr("Активен", "Active") : tr("Отключен", "Inactive")}
                              </span>
                              {user.is_staff && (
                                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                                  {tr("Сотрудник", "Staff")}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">{user.email || tr("Email не указан", "No email configured")}</div>
                            <div className="text-xs text-muted-foreground">
                              {tr("Профиль", "Profile")}: <span className="text-foreground">{profileLabel(user.access_profile, lang)}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(user.groups || []).length ? (
                                (user.groups || []).map((group) => (
                                  <span key={group.id} className="rounded-full border border-border/70 bg-secondary/30 px-2.5 py-1 text-[11px] text-muted-foreground">
                                    {group.name}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">{tr("Группы не назначены", "No groups assigned")}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => startEdit(user)}>{tr("Изменить", "Edit")}</Button>
                            <Button size="sm" variant="outline" onClick={() => setPasswordTarget(user)}>{tr("Сбросить пароль", "Reset password")}</Button>
                            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(user)}>{tr("Удалить", "Delete")}</Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <Input value={editing.username || ""} onChange={(event) => setEditing((state) => ({ ...state, username: event.target.value }))} />
                          <Input value={editing.email || ""} onChange={(event) => setEditing((state) => ({ ...state, email: event.target.value }))} />
                          <select
                            value={editing.access_profile || "custom"}
                            onChange={(event) => setEditing((state) => ({ ...state, access_profile: event.target.value }))}
                            className="enterprise-select"
                          >
                            <option value="server_only">{tr("Только серверы", "Server only")}</option>
                            <option value="admin_full">{tr("Полный админ", "Admin full")}</option>
                            <option value="custom">{tr("Кастом", "Custom")}</option>
                            <option value="reset_defaults">{tr("Сброс по умолчанию", "Reset defaults")}</option>
                          </select>
                        </div>
                        <div className="flex flex-wrap gap-4">
                          <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                            <Switch checked={!!editing.is_staff} onCheckedChange={(value) => setEditing((state) => ({ ...state, is_staff: value }))} />
                            {tr("Права сотрудника", "Staff access")}
                          </label>
                          <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                            <Switch checked={!!editing.is_active} onCheckedChange={(value) => setEditing((state) => ({ ...state, is_active: value }))} />
                            {tr("Аккаунт активен", "Account active")}
                          </label>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr("Участие в группах", "Group membership")}</p>
                          <div className="flex flex-wrap gap-2">
                            {groups.map((group) => (
                              <button
                                key={group.id}
                                type="button"
                                onClick={() => setEditing((state) => ({ ...state, groups: toggleGroup(currentGroups, group.id) }))}
                                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${currentGroups.includes(group.id) ? "border-primary/50 bg-primary/12 text-primary" : "border-border/70 bg-secondary/20 text-muted-foreground hover:border-primary/25 hover:text-foreground"}`}
                              >
                                {group.name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={saveEdit}>{tr("Сохранить изменения", "Save changes")}</Button>
                          <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditing({}); }}>{tr("Отмена", "Cancel")}</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!filteredUsers.length && (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  {tr("По текущему фильтру пользователей не найдено.", "No users match the current filter.")}
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title={tr("Создать пользователя", "Create user")}
            description={tr("Создайте новый аккаунт с профилем и начальными группами.", "Provision a new account with initial profile and groups.")}
          >
            <div className="space-y-4">
              <div className="grid gap-3">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">{tr("Логин", "Username")}</Label>
                  <Input value={form.username} onChange={(event) => setForm((state) => ({ ...state, username: event.target.value }))} placeholder={tr("operator-team", "operator-team")} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">{tr("Email", "Email")}</Label>
                  <Input value={form.email} onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))} placeholder={tr("team@example.com", "team@example.com")} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">{tr("Первичный пароль", "Initial password")}</Label>
                  <Input type="password" value={form.password} onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))} placeholder={tr("Временный пароль", "Temporary password")} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">{tr("Профиль", "Profile")}</Label>
                  <select
                    value={form.access_profile}
                    onChange={(event) => setForm((state) => ({ ...state, access_profile: event.target.value }))}
                    className="enterprise-select"
                  >
                    <option value="server_only">{tr("Только серверы", "Server only")}</option>
                    <option value="admin_full">{tr("Полный админ", "Admin full")}</option>
                    <option value="custom">{tr("Кастом", "Custom")}</option>
                    <option value="reset_defaults">{tr("Сброс по умолчанию", "Reset defaults")}</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                  <Switch checked={form.is_staff} onCheckedChange={(value) => setForm((state) => ({ ...state, is_staff: value }))} />
                  {tr("Права сотрудника", "Staff access")}
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                  <Switch checked={form.is_active} onCheckedChange={(value) => setForm((state) => ({ ...state, is_active: value }))} />
                  {tr("Аккаунт активен", "Account active")}
                </label>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr("Группы", "Groups")}</p>
                <p className="text-xs text-muted-foreground">{selectedGroupsLabel || tr("Группы пока не выбраны.", "No groups selected yet.")}</p>
                <div className="flex flex-wrap gap-2">
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setForm((state) => ({ ...state, groups: toggleGroup(state.groups, group.id) }))}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${form.groups.includes(group.id) ? "border-primary/50 bg-primary/12 text-primary" : "border-border/70 bg-secondary/20 text-muted-foreground hover:border-primary/25 hover:text-foreground"}`}
                    >
                      {group.name}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={onCreate} disabled={saving || !form.username || !form.password} className="w-full gap-2">
                <UserPlus className="h-4 w-4" />
                {saving ? tr("Создание...", "Creating...") : tr("Создать пользователя", "Create user")}
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>

      <Dialog open={!!passwordTarget} onOpenChange={(open) => { if (!open) { setPasswordTarget(null); setNewPassword(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("Сброс пароля", "Reset password")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {tr("Установите новый пароль для", "Set a new password for")} <span className="font-medium text-foreground">{passwordTarget?.username}</span>.
            </p>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Новый пароль", "New password")}</Label>
              <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={tr("Введите временный пароль", "Enter a temporary password")} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPasswordTarget(null); setNewPassword(""); }}>{tr("Отмена", "Cancel")}</Button>
            <Button onClick={savePassword} disabled={passwordSaving || !newPassword.trim()}>
              {passwordSaving ? tr("Сохранение...", "Saving...") : tr("Обновить пароль", "Update password")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={tr("Удалить пользователя", "Delete user")}
        description={deleteTarget ? tr(`Удалить пользователя "${deleteTarget.username}" и отозвать прямой доступ к платформе?`, `Delete user "${deleteTarget.username}" and revoke direct platform access?`) : ""}
        confirmLabel={tr("Удалить пользователя", "Delete user")}
        onConfirm={() => {
          if (!deleteTarget) return;
          void removeUser(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </PageShell>
  );
}
