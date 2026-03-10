import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAccessPermission,
  fetchAccessPermissions,
  fetchAccessUsers,
  updateAccessPermission,
  upsertAccessPermission,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { PageGrid, PageShell, SectionCard, StatusBadge } from "@/components/ui/page-shell";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-full border border-transparent bg-background/30 px-3 py-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{value}</span> {label}
    </div>
  );
}

export default function SettingsPermissionsPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const queryClient = useQueryClient();
  const [newUserId, setNewUserId] = useState<number>(0);
  const [newFeature, setNewFeature] = useState<string>("");
  const [newAllowed, setNewAllowed] = useState<boolean>(true);
  const [filterUserId, setFilterUserId] = useState<number>(0);
  const [filterFeature, setFilterFeature] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; username: string; feature: string } | null>(null);

  const { data: permsData, isLoading, error } = useQuery({
    queryKey: ["access", "permissions"],
    queryFn: fetchAccessPermissions,
  });
  const { data: usersData } = useQuery({ queryKey: ["access", "users"], queryFn: fetchAccessUsers });

  const permissions = permsData?.permissions || [];
  const features = permsData?.features || [];
  const users = usersData?.users || [];
  const allowedCount = permissions.filter((permission) => permission.allowed).length;
  const deniedCount = permissions.filter((permission) => !permission.allowed).length;
  const hasFilters = filterUserId !== 0 || !!filterFeature;
  const filteredPermissions = permissions.filter((permission) => {
    if (filterUserId && permission.user_id !== filterUserId) return false;
    if (filterFeature && permission.feature !== filterFeature) return false;
    return true;
  });

  useEffect(() => {
    if (!newUserId && users.length) setNewUserId(users[0].id);
    if (!newFeature && features.length) setNewFeature(features[0].value);
  }, [newUserId, newFeature, users, features]);

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ["access", "permissions"] });
  };

  const onCreate = async () => {
    if (!newUserId || !newFeature) return;
    await upsertAccessPermission({ user_id: newUserId, feature: newFeature, allowed: newAllowed });
    await reload();
  };

  const toggleAllowed = async (permId: number, allowed: boolean) => {
    await updateAccessPermission(permId, !allowed);
    await reload();
  };

  const remove = async (permId: number) => {
    await deleteAccessPermission(permId);
    await reload();
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{tr("Загрузка прав доступа...", "Loading permissions...")}</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{tr("Не удалось загрузить права доступа.", "Failed to load permissions.")}</div>;

  return (
    <PageShell width="6xl" className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <div className="enterprise-kicker">{tr("Управление доступом", "Access control")}</div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{tr("Права доступа", "Permissions")}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {tr(
                "Используйте явные allow/deny только как точечные исключения, когда профиля или группы уже недостаточно.",
                "Use explicit allow and deny rules only as targeted exceptions when profile or group access is not enough.",
              )}
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-2" onClick={reload}>
            <RefreshCw className="h-4 w-4" />
            {tr("Обновить", "Refresh")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <SummaryPill label={tr("правил", "rules")} value={permissions.length} />
          <SummaryPill label={tr("разрешено", "allowed")} value={allowedCount} />
          <SummaryPill label={tr("запрещено", "denied")} value={deniedCount} />
        </div>
      </section>

      <PageGrid sidebar className="items-start">
        <SectionCard
          title={tr("Список правил", "Rule list")}
          description={tr(
            "Сначала отфильтруйте пользователя или функцию, затем меняйте только нужное исключение.",
            "Filter by user or feature first, then change only the override you actually need.",
          )}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <select value={filterUserId} onChange={(event) => setFilterUserId(Number(event.target.value))} className="enterprise-select min-w-[180px]">
                <option value={0}>{tr("Все пользователи", "All users")}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
              <select value={filterFeature} onChange={(event) => setFilterFeature(event.target.value)} className="enterprise-select min-w-[220px]">
                <option value="">{tr("Все функции", "All features")}</option>
                {features.map((feature) => (
                  <option key={feature.value} value={feature.value}>
                    {feature.label}
                  </option>
                ))}
              </select>
              {hasFilters ? (
                <Button size="sm" variant="outline" onClick={() => { setFilterUserId(0); setFilterFeature(""); }}>
                  {tr("Сбросить", "Clear")}
                </Button>
              ) : null}
            </div>
          )}
        >
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/20">
            {filteredPermissions.map((permission, index) => (
              <div
                key={permission.id}
                className={`${index ? "border-t border-border/70" : ""} flex flex-col gap-4 px-4 py-4 sm:px-5 xl:flex-row xl:items-center xl:justify-between`}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-foreground">{permission.username}</span>
                    <StatusBadge
                      label={permission.allowed ? tr("Разрешено", "Allowed") : tr("Запрещено", "Denied")}
                      tone={permission.allowed ? "success" : "neutral"}
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">{permission.feature_display || permission.feature}</div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleAllowed(permission.id, permission.allowed)}>
                    {permission.allowed ? tr("Сделать deny", "Switch to deny") : tr("Сделать allow", "Switch to allow")}
                  </Button>
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
                        onClick={() =>
                          setDeleteTarget({
                            id: permission.id,
                            username: permission.username,
                            feature: permission.feature_display || permission.feature,
                          })
                        }
                      >
                        {tr("Удалить", "Delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}

            {!filteredPermissions.length ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                {tr("По выбранным фильтрам правила не найдены.", "No permissions match the selected filters.")}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title={tr("Новое правило", "New rule")}
          description={tr(
            "Добавьте точечное исключение для конкретного пользователя. Если правило уже есть, запись обновится.",
            "Add a targeted override for one user. If the rule already exists, it will be updated.",
          )}
          className="xl:sticky xl:top-5"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Пользователь", "User")}</Label>
              <select value={newUserId} onChange={(event) => setNewUserId(Number(event.target.value))} className="enterprise-select">
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Функция", "Feature")}</Label>
              <select value={newFeature} onChange={(event) => setNewFeature(event.target.value)} className="enterprise-select">
                {features.map((feature) => (
                  <option key={feature.value} value={feature.value}>
                    {feature.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Решение", "Decision")}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setNewAllowed(true)}
                  className={`rounded-xl border px-3 py-3 text-sm transition-colors ${
                    newAllowed
                      ? "border-border/80 bg-background/45 text-foreground"
                      : "border-border/70 bg-background/25 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tr("Разрешить", "Allow")}
                </button>
                <button
                  type="button"
                  onClick={() => setNewAllowed(false)}
                  className={`rounded-xl border px-3 py-3 text-sm transition-colors ${
                    !newAllowed
                      ? "border-border/80 bg-background/45 text-foreground"
                      : "border-border/70 bg-background/25 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tr("Запретить", "Deny")}
                </button>
              </div>
            </div>

            <Button onClick={onCreate} className="w-full">
              {tr("Сохранить правило", "Save rule")}
            </Button>
          </div>
        </SectionCard>
      </PageGrid>

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={tr("Удалить правило", "Delete permission")}
        description={
          deleteTarget
            ? tr(
                `Удалить явное правило для "${deleteTarget.username}" по функции "${deleteTarget.feature}"?`,
                `Delete explicit permission for "${deleteTarget.username}" on "${deleteTarget.feature}"?`,
              )
            : ""
        }
        confirmLabel={tr("Удалить правило", "Delete permission")}
        onConfirm={() => {
          if (!deleteTarget) return;
          void remove(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </PageShell>
  );
}
