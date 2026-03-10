import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAccessGroup, deleteAccessGroup, fetchAccessGroups, fetchAccessUsers, updateAccessGroup } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageGrid, PageShell, SectionCard, StatusBadge } from "@/components/ui/page-shell";
import { FolderCog, MoreHorizontal, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-full border border-transparent bg-background/30 px-3 py-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{value}</span> {label}
    </div>
  );
}

export default function SettingsGroupsPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const { data: groupsData, isLoading, error } = useQuery({ queryKey: ["access", "groups"], queryFn: fetchAccessGroups });
  const { data: usersData } = useQuery({ queryKey: ["access", "users"], queryFn: fetchAccessUsers });

  const groups = groupsData?.groups || [];
  const users = usersData?.users || [];
  const groupQuery = search.trim().toLowerCase();
  const filteredGroups = groups.filter((group) => group.name.toLowerCase().includes(groupQuery));
  const groupsWithMembers = groups.filter((group) => (group.member_count || 0) > 0).length;
  const emptyGroups = groups.length - groupsWithMembers;
  const largestGroup = useMemo(() => groups.reduce((max, group) => Math.max(max, group.member_count || 0), 0), [groups]);
  const memberQuery = memberSearch.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    if (!memberQuery) return true;
    return user.username.toLowerCase().includes(memberQuery) || (user.email || "").toLowerCase().includes(memberQuery);
  });

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
    setMemberSearch("");
    await reload();
  };

  const renameGroup = async (id: number) => {
    if (!editingName.trim()) return;
    await updateAccessGroup(id, { name: editingName.trim() });
    setEditingId(null);
    setEditingName("");
    await reload();
  };

  const deleteGroup = async (id: number) => {
    await deleteAccessGroup(id);
    await reload();
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{tr("Загрузка групп...", "Loading groups...")}</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{tr("Не удалось загрузить группы.", "Failed to load groups.")}</div>;

  return (
    <PageShell width="6xl" className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <div className="enterprise-kicker">{tr("Управление доступом", "Access control")}</div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{tr("Группы", "Groups")}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {tr(
                "Соберите понятные группы доступа, чтобы не раздавать одинаковые права каждому пользователю вручную.",
                "Build clear access groups so you do not have to assign the same access to every user by hand.",
              )}
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-2" onClick={reload}>
            <RefreshCw className="h-4 w-4" />
            {tr("Обновить", "Refresh")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <SummaryPill label={tr("групп", "groups")} value={groups.length} />
          <SummaryPill label={tr("с участниками", "with members")} value={groupsWithMembers} />
          <SummaryPill label={tr("пустые", "empty")} value={emptyGroups} />
          <SummaryPill label={tr("макс. размер", "largest group")} value={largestGroup} />
        </div>
      </section>

      <PageGrid sidebar className="items-start">
        <SectionCard
          title={tr("Список групп", "Group list")}
          description={tr(
            "Поддерживайте названия короткими и понятными. Ненужные группы удаляйте, чтобы каталог не распухал.",
            "Keep names short and clear. Remove unused groups so the catalog stays easy to scan.",
          )}
          actions={(
            <div className="flex flex-col gap-2 sm:items-end">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tr("Поиск групп", "Search groups")}
                className="w-full sm:w-64"
              />
              <div className="text-xs text-muted-foreground">
                {tr("Показано", "Showing")} {filteredGroups.length} / {groups.length}
              </div>
            </div>
          )}
        >
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/20">
            {filteredGroups.map((group, index) => {
              const isEditing = editingId === group.id;
              const members = group.members || [];
              const previewMembers = members.slice(0, 6);
              const hiddenMembers = Math.max(members.length - previewMembers.length, 0);

              return (
                <div
                  key={group.id}
                  className={`${index ? "border-t border-border/70" : ""} px-4 py-4 sm:px-5`}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {isEditing ? (
                          <div className="w-full max-w-sm">
                            <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                          </div>
                        ) : (
                          <span className="text-base font-semibold text-foreground">{group.name}</span>
                        )}
                        <StatusBadge
                          label={
                            group.member_count
                              ? `${group.member_count} ${tr("участников", "members")}`
                              : tr("Пока пусто", "Empty")
                          }
                          tone="neutral"
                        />
                      </div>

                      {previewMembers.length ? (
                        <div className="flex flex-wrap gap-2">
                          {previewMembers.map((member) => (
                            <span
                              key={member.id}
                              className="rounded-full bg-background/35 px-2.5 py-1 text-[11px] text-muted-foreground"
                            >
                              {member.username}
                            </span>
                          ))}
                          {hiddenMembers ? (
                            <span className="rounded-full bg-background/30 px-2.5 py-1 text-[11px] text-muted-foreground">
                              +{hiddenMembers}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {tr("В группе пока нет участников.", "No members in this group yet.")}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {isEditing ? (
                        <>
                          <Button size="sm" onClick={() => renameGroup(group.id)}>
                            {tr("Сохранить", "Save")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(null);
                              setEditingName("");
                            }}
                          >
                            {tr("Отмена", "Cancel")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(group.id);
                            setEditingName(group.name);
                          }}
                        >
                          {tr("Переименовать", "Rename")}
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
                            <MoreHorizontal className="h-4 w-4" />
                            {tr("Ещё", "More")}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            className="text-red-300 focus:text-red-200"
                            onClick={() => setDeleteTarget({ id: group.id, name: group.name })}
                          >
                            {tr("Удалить", "Delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              );
            })}

            {!filteredGroups.length ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                {tr("По текущему фильтру групп не найдено.", "No groups match the current filter.")}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title={tr("Новая группа", "New group")}
          description={tr(
            "Создайте группу и сразу отметьте тех, кто должен входить в нее с первого дня.",
            "Create a group and immediately mark the people who should belong to it from day one.",
          )}
          className="xl:sticky xl:top-5"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Название группы", "Group name")}</Label>
              <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={tr("Команда эксплуатации", "Operations team")} />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm font-medium text-foreground">{tr("Начальные участники", "Initial members")}</Label>
                <div className="text-xs text-muted-foreground">
                  {newMembers.length
                    ? `${newMembers.length} ${tr("выбрано", "selected")}`
                    : tr("Никто не выбран", "No members selected")}
                </div>
              </div>
              <Input
                value={memberSearch}
                onChange={(event) => setMemberSearch(event.target.value)}
                placeholder={tr("Найти пользователя", "Find a user")}
              />
              <div className="max-h-72 overflow-auto rounded-xl border border-border/70 bg-background/20">
                {filteredUsers.length ? (
                  filteredUsers.map((user, index) => {
                    const selected = newMembers.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        className={`${index ? "border-t border-border/70" : ""} flex w-full items-center justify-between px-3 py-3 text-left transition-colors ${
                          selected ? "bg-background/45 text-foreground" : "hover:bg-background/55"
                        }`}
                        onClick={() => toggleMember(user.id)}
                        type="button"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{user.username}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {user.email || tr("Email не указан", "No email configured")}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {selected ? tr("Добавлен", "Added") : tr("Добавить", "Add")}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    {tr("Пользователи по фильтру не найдены.", "No users match this filter.")}
                  </div>
                )}
              </div>
            </div>

            <Button onClick={onCreate} disabled={!newName.trim()} className="w-full gap-2">
              <FolderCog className="h-4 w-4" />
              {tr("Создать группу", "Create group")}
            </Button>
          </div>
        </SectionCard>
      </PageGrid>

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={tr("Удалить группу", "Delete group")}
        description={
          deleteTarget
            ? tr(
                `Удалить группу "${deleteTarget.name}"? Участники потеряют это назначение.`,
                `Delete group "${deleteTarget.name}" from catalog? Members will lose this assignment.`,
              )
            : ""
        }
        confirmLabel={tr("Удалить группу", "Delete group")}
        onConfirm={() => {
          if (!deleteTarget) return;
          void deleteGroup(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </PageShell>
  );
}
