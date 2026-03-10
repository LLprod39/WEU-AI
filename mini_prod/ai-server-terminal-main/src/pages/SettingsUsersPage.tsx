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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { PageGrid, PageShell, SectionCard, StatusBadge } from "@/components/ui/page-shell";
import { MoreHorizontal, RefreshCw } from "lucide-react";
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

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-full border border-transparent bg-background/30 px-3 py-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{value}</span> {label}
    </div>
  );
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
  const query = search.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    if (!query) return true;
    return user.username.toLowerCase().includes(query) || (user.email || "").toLowerCase().includes(query);
  });

  const selectedGroupsLabel = useMemo(() => {
    const selected = groups.filter((group) => form.groups.includes(group.id));
    return selected.map((group) => group.name).join(", ");
  }, [form.groups, groups]);

  const activeUsers = users.filter((user) => user.is_active).length;
  const inactiveUsers = users.length - activeUsers;
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
    <PageShell width="6xl" className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <div className="enterprise-kicker">{tr("Управление доступом", "Access control")}</div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{tr("Пользователи", "Users")}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {tr(
                "Держите список аккаунтов простым: кто может войти, с каким профилем стартует и в какие группы уже включен.",
                "Keep the account list simple: who can sign in, which profile they start with, and which groups they already belong to.",
              )}
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-2" onClick={reload}>
            <RefreshCw className="h-4 w-4" />
            {tr("Обновить", "Refresh")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <SummaryPill label={tr("всего", "total")} value={users.length} />
          <SummaryPill label={tr("активны", "active")} value={activeUsers} />
          <SummaryPill label={tr("отключены", "inactive")} value={inactiveUsers} />
          <SummaryPill label={tr("сотрудники", "staff")} value={staffUsers} />
          <SummaryPill label={tr("админ-профиль", "admin profile")} value={privilegedUsers} />
        </div>
      </section>

      <PageGrid sidebar className="items-start">
        <SectionCard
          title={tr("Список пользователей", "User list")}
          description={tr(
            "Найдите аккаунт, быстро измените статус, профиль или группы и при необходимости сбросьте пароль.",
            "Find an account, adjust status, profile or groups, and reset the password when needed.",
          )}
          actions={(
            <div className="flex flex-col gap-2 sm:items-end">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tr("Поиск по логину или email", "Search by username or email")}
                className="w-full sm:w-72"
              />
              <div className="text-xs text-muted-foreground">
                {tr("Показано", "Showing")} {filteredUsers.length} / {users.length}
              </div>
            </div>
          )}
        >
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/20">
            {filteredUsers.map((user, index) => {
              const isEditing = editingId === user.id;
              const currentGroups = isEditing ? editing.groups || [] : (user.groups || []).map((group) => group.id);
              return (
                <div
                  key={user.id}
                  className={`${index ? "border-t border-border/70" : ""} px-4 py-4 sm:px-5`}
                >
                  {!isEditing ? (
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-foreground">{user.username}</span>
                          <StatusBadge
                            label={user.is_active ? tr("Активен", "Active") : tr("Отключен", "Inactive")}
                            tone={user.is_active ? "success" : "neutral"}
                          />
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span>{user.email || tr("Email не указан", "No email configured")}</span>
                          <span>
                            {tr("Профиль", "Profile")}: {profileLabel(user.access_profile, lang)}
                          </span>
                          <span>
                            {tr("Групп", "Groups")}: {(user.groups || []).length}
                          </span>
                          {user.is_staff ? <span>{tr("Сотрудник", "Staff")}</span> : null}
                          {user.access_profile === "admin_full" || user.is_superuser ? <span>{tr("Полный доступ", "Full access")}</span> : null}
                        </div>

                        {(user.groups || []).length ? (
                          <div className="flex flex-wrap gap-2">
                            {(user.groups || []).map((group) => (
                              <span
                                key={group.id}
                                className="rounded-full bg-background/35 px-2.5 py-1 text-[11px] text-muted-foreground"
                              >
                                {group.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">{tr("Группы не назначены", "No groups assigned")}</div>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => startEdit(user)}>
                          {tr("Изменить", "Edit")}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
                              <MoreHorizontal className="h-4 w-4" />
                              {tr("Ещё", "More")}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => setPasswordTarget(user)}>
                              {tr("Сбросить пароль", "Reset password")}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-300 focus:text-red-200" onClick={() => setDeleteTarget(user)}>
                              {tr("Удалить", "Delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">{tr("Логин", "Username")}</Label>
                          <Input
                            value={editing.username || ""}
                            onChange={(event) => setEditing((state) => ({ ...state, username: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">{tr("Email", "Email")}</Label>
                          <Input
                            value={editing.email || ""}
                            onChange={(event) => setEditing((state) => ({ ...state, email: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">{tr("Профиль", "Profile")}</Label>
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
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex items-center justify-between rounded-xl border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                          <span>{tr("Права сотрудника", "Staff access")}</span>
                          <Switch checked={!!editing.is_staff} onCheckedChange={(value) => setEditing((state) => ({ ...state, is_staff: value }))} />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                          <span>{tr("Аккаунт активен", "Account active")}</span>
                          <Switch checked={!!editing.is_active} onCheckedChange={(value) => setEditing((state) => ({ ...state, is_active: value }))} />
                        </label>
                      </div>

                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label className="text-sm font-medium text-foreground">{tr("Группы", "Groups")}</Label>
                          <div className="text-xs text-muted-foreground">
                            {currentGroups.length
                              ? `${currentGroups.length} ${tr("выбрано", "selected")}`
                              : tr("Группы не выбраны", "No groups selected")}
                          </div>
                        </div>
                        <div className="max-h-56 overflow-auto rounded-xl border border-border/70 bg-background/20">
                          {groups.length ? (
                            groups.map((group, groupIndex) => {
                              const selected = currentGroups.includes(group.id);
                              return (
                                <button
                                  key={group.id}
                                  type="button"
                                  onClick={() =>
                                    setEditing((state) => ({ ...state, groups: toggleGroup(currentGroups, group.id) }))
                                  }
                                  className={`${groupIndex ? "border-t border-border/70" : ""} flex w-full items-center justify-between px-3 py-3 text-left transition-colors ${
                                    selected ? "bg-background/45 text-foreground" : "hover:bg-background/55"
                                  }`}
                                >
                                  <span className="text-sm">{group.name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {selected ? tr("Добавлена", "Added") : tr("Назначить", "Assign")}
                                  </span>
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-3 py-3 text-sm text-muted-foreground">
                              {tr("Сначала создайте хотя бы одну группу.", "Create at least one group first.")}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={saveEdit}>
                          {tr("Сохранить изменения", "Save changes")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null);
                            setEditing({});
                          }}
                        >
                          {tr("Отмена", "Cancel")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!filteredUsers.length ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                {tr("По текущему фильтру пользователей не найдено.", "No users match the current filter.")}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title={tr("Новый пользователь", "New user")}
          description={tr(
            "Создайте аккаунт, задайте стартовый профиль и при необходимости сразу добавьте его в группы.",
            "Create an account, choose the starting profile, and add it to groups if needed.",
          )}
          className="xl:sticky xl:top-5"
        >
          <div className="space-y-4">
            <div className="grid gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">{tr("Логин", "Username")}</Label>
                <Input
                  value={form.username}
                  onChange={(event) => setForm((state) => ({ ...state, username: event.target.value }))}
                  placeholder={tr("operator-team", "operator-team")}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">{tr("Email", "Email")}</Label>
                <Input
                  value={form.email}
                  onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))}
                  placeholder={tr("team@example.com", "team@example.com")}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">{tr("Первичный пароль", "Initial password")}</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))}
                  placeholder={tr("Временный пароль", "Temporary password")}
                />
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
              <label className="flex items-center justify-between rounded-xl border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                <span>{tr("Права сотрудника", "Staff access")}</span>
                <Switch checked={form.is_staff} onCheckedChange={(value) => setForm((state) => ({ ...state, is_staff: value }))} />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                <span>{tr("Аккаунт активен", "Account active")}</span>
                <Switch checked={form.is_active} onCheckedChange={(value) => setForm((state) => ({ ...state, is_active: value }))} />
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm font-medium text-foreground">{tr("Группы", "Groups")}</Label>
                <div className="text-xs text-muted-foreground">
                  {selectedGroupsLabel || tr("Группы пока не выбраны.", "No groups selected yet.")}
                </div>
              </div>
              <div className="max-h-64 overflow-auto rounded-xl border border-border/70 bg-background/20">
                {groups.length ? (
                  groups.map((group, index) => {
                    const selected = form.groups.includes(group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setForm((state) => ({ ...state, groups: toggleGroup(state.groups, group.id) }))}
                        className={`${index ? "border-t border-border/70" : ""} flex w-full items-center justify-between px-3 py-3 text-left transition-colors ${
                          selected ? "bg-background/45 text-foreground" : "hover:bg-background/55"
                        }`}
                      >
                        <span className="text-sm">{group.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {selected ? tr("Добавлена", "Added") : tr("Назначить", "Assign")}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    {tr("Сначала создайте хотя бы одну группу.", "Create at least one group first.")}
                  </div>
                )}
              </div>
            </div>

            <Button onClick={onCreate} disabled={saving || !form.username || !form.password} className="w-full">
              {saving ? tr("Создание...", "Creating...") : tr("Создать пользователя", "Create user")}
            </Button>
          </div>
        </SectionCard>
      </PageGrid>

      <Dialog
        open={!!passwordTarget}
        onOpenChange={(open) => {
          if (!open) {
            setPasswordTarget(null);
            setNewPassword("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("Сброс пароля", "Reset password")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {tr("Установите новый пароль для", "Set a new password for")}{" "}
              <span className="font-medium text-foreground">{passwordTarget?.username}</span>.
            </p>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Новый пароль", "New password")}</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder={tr("Введите временный пароль", "Enter a temporary password")}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPasswordTarget(null);
                setNewPassword("");
              }}
            >
              {tr("Отмена", "Cancel")}
            </Button>
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
        description={
          deleteTarget
            ? tr(
                `Удалить пользователя "${deleteTarget.username}" и отозвать прямой доступ к платформе?`,
                `Delete user "${deleteTarget.username}" and revoke direct platform access?`,
              )
            : ""
        }
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
