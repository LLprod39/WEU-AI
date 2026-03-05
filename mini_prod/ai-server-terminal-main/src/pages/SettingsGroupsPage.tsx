import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAccessGroup, deleteAccessGroup, fetchAccessGroups, fetchAccessUsers, updateAccessGroup } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Input } from "@/components/ui/input";
import { MetricCard, MetricGrid, PageHero, PageShell, SectionCard } from "@/components/ui/page-shell";
import { Label } from "@/components/ui/label";
import { FolderCog, RefreshCw, ShieldCheck, Users, UsersRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function SettingsGroupsPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const { data: groupsData, isLoading, error } = useQuery({ queryKey: ["access", "groups"], queryFn: fetchAccessGroups });
  const { data: usersData } = useQuery({ queryKey: ["access", "users"], queryFn: fetchAccessUsers });

  const groups = groupsData?.groups || [];
  const users = usersData?.users || [];
  const filteredGroups = groups.filter((group) => group.name.toLowerCase().includes(search.trim().toLowerCase()));
  const groupsWithMembers = groups.filter((group) => (group.member_count || 0) > 0).length;
  const largestGroup = useMemo(() => groups.reduce((max, group) => Math.max(max, group.member_count || 0), 0), [groups]);

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ["access", "groups"] });
  };

  const toggleMember = (id: number) => {
    setNewMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const onCreate = async () => {
    if (!newName.trim()) return;
    await createAccessGroup({ name: newName.trim(), members: newMembers });
    setNewName("");
    setNewMembers([]);
    await reload();
  };

  const renameGroup = async (id: number) => {
    if (!editingName.trim()) return;
    await updateAccessGroup(id, { name: editingName.trim() });
    setEditingId(null);
    setEditingName("");
    await reload();
  };

  const deleteGroup = async (id: number, name: string) => {
    await deleteAccessGroup(id);
    await reload();
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{tr("Загрузка групп...", "Loading groups...")}</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{tr("Не удалось загрузить группы.", "Failed to load groups.")}</div>;

  return (
    <PageShell width="6xl">
      <PageHero
        kicker={tr("Управление доступом", "Access Control")}
        title={tr("Группы", "Groups")}
        description={tr("Поддерживайте переиспользуемые группы доступа для операторов платформы.", "Maintain reusable access groups for platform operators.")}
        actions={(
          <Button size="sm" variant="outline" className="gap-2" onClick={reload}>
            <RefreshCw className="h-4 w-4" />
            {tr("Обновить группы", "Refresh groups")}
          </Button>
        )}
      >
        <MetricGrid className="xl:grid-cols-3">
          <MetricCard label={tr("Групп", "Groups")} value={groups.length} description={tr("Переиспользуемые группы доступа в системе.", "Reusable access containers currently configured.")} icon={<UsersRound className="h-5 w-5 text-primary" />} />
          <MetricCard label={tr("С участниками", "With members")} value={groupsWithMembers} description={tr("Группы, где уже назначены пользователи.", "Groups that already have at least one assigned user.")} icon={<ShieldCheck className="h-5 w-5 text-emerald-300" />} />
          <MetricCard label={tr("Макс. размер", "Largest group")} value={largestGroup} description={tr("Максимальное число участников в одной группе.", "Current peak member count across the access catalog.")} icon={<Users className="h-5 w-5 text-violet-300" />} />
        </MetricGrid>
      </PageHero>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <SectionCard
          title={tr("Создать группу", "Create group")}
          description={tr("Создайте новую группу доступа и заранее назначьте участников.", "Define a new access group and pre-attach members.")}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Название группы", "Group name")}</Label>
              <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={tr("Команда эксплуатации", "Operations team")} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr("Начальные участники", "Initial members")}</p>
              <div className="flex flex-wrap gap-2">
                {users.map((user) => (
                  <button
                    key={user.id}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${newMembers.includes(user.id) ? "border-primary/50 bg-primary/12 text-primary" : "border-border/70 bg-secondary/20 text-muted-foreground hover:border-primary/25 hover:text-foreground"}`}
                    onClick={() => toggleMember(user.id)}
                    type="button"
                  >
                    {user.username}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={onCreate} disabled={!newName.trim()} className="w-full gap-2">
              <FolderCog className="h-4 w-4" />
              {tr("Создать группу", "Create group")}
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title={tr("Каталог групп", "Group catalog")}
          description={tr("Переименовывайте группы, проверяйте состав и поддерживайте структуру доступа.", "Rename groups, inspect membership and keep access structure readable.")}
          actions={(
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tr("Поиск групп", "Search groups")}
              className="w-full sm:w-64"
            />
          )}
        >
          <div className="space-y-3">
            {filteredGroups.map((group) => {
              const isEditing = editingId === group.id;
              return (
                <div key={group.id} className="rounded-2xl border border-border/70 bg-background/30 px-4 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                      {isEditing ? (
                        <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} className="max-w-sm" />
                      ) : (
                        <div className="text-base font-semibold text-foreground">{group.name}</div>
                      )}
                      <div className="text-xs text-muted-foreground">{tr("Участников", "Members")}: {group.member_count}</div>
                      <div className="flex flex-wrap gap-2">
                        {(group.members || []).length ? (
                          (group.members || []).map((member) => (
                            <span key={member.id} className="rounded-full border border-border/70 bg-secondary/20 px-2.5 py-1 text-[11px] text-muted-foreground">
                              {member.username}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">{tr("Пока нет назначенных участников", "No members assigned yet")}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isEditing ? (
                        <>
                          <Button size="sm" onClick={() => renameGroup(group.id)}>{tr("Сохранить", "Save")}</Button>
                          <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditingName(""); }}>{tr("Отмена", "Cancel")}</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setEditingId(group.id); setEditingName(group.name); }}>
                          {tr("Переименовать", "Rename")}
                        </Button>
                      )}
                      <Button size="sm" variant="destructive" onClick={() => setDeleteTarget({ id: group.id, name: group.name })}>
                        {tr("Удалить", "Delete")}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!filteredGroups.length && (
              <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                {tr("По текущему фильтру групп не найдено.", "No groups match the current filter.")}
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={tr("Удалить группу", "Delete group")}
        description={deleteTarget ? tr(`Удалить группу "${deleteTarget.name}"? Участники потеряют это назначение.`, `Delete group "${deleteTarget.name}" from catalog? Members will lose this assignment.`) : ""}
        confirmLabel={tr("Удалить группу", "Delete group")}
        onConfirm={() => {
          if (!deleteTarget) return;
          void deleteGroup(deleteTarget.id, deleteTarget.name);
          setDeleteTarget(null);
        }}
      />
    </PageShell>
  );
}
