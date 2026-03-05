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
import { MetricCard, MetricGrid, PageHero, PageShell, SectionCard } from "@/components/ui/page-shell";
import { Label } from "@/components/ui/label";
import { Ban, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useI18n } from "@/lib/i18n";

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
  const filteredPermissions = permissions.filter((permission) => {
    if (filterUserId && permission.user_id !== filterUserId) return false;
    if (filterFeature && permission.feature !== filterFeature) return false;
    return true;
  });

  useEffect(() => {
    if (!newUserId && users.length) setNewUserId(users[0].id);
    if (!newFeature && features.length) setNewFeature(features[0].value);
    if (!filterFeature && features.length) setFilterFeature("");
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
    <PageShell width="6xl">
      <PageHero
        kicker={tr("Управление доступом", "Access Control")}
        title={tr("Права доступа", "Permissions")}
        description={tr("Явные правила allow/deny для пользователей, когда групповых профилей недостаточно.", "Pin explicit allow and deny rules for users when group profiles are not enough.")}
        actions={(
          <Button size="sm" variant="outline" className="gap-2" onClick={reload}>
            <RefreshCw className="h-4 w-4" />
            {tr("Обновить права", "Refresh permissions")}
          </Button>
        )}
      >
        <MetricGrid className="xl:grid-cols-3">
          <MetricCard label={tr("Правил", "Permission rules")} value={permissions.length} description={tr("Явные переопределения, сохраненные в слое доступа.", "Explicit overrides currently stored in the access layer.")} icon={<SlidersHorizontal className="h-5 w-5 text-primary" />} />
          <MetricCard label={tr("Разрешено", "Allowed")} value={allowedCount} description={tr("Правила, которые явно разрешают функцию.", "Rules that explicitly grant access to a feature.")} icon={<ShieldCheck className="h-5 w-5 text-emerald-300" />} />
          <MetricCard label={tr("Запрещено", "Denied")} value={deniedCount} description={tr("Правила, которые явно запрещают функцию.", "Rules that explicitly block access to a feature.")} icon={<Ban className="h-5 w-5 text-amber-300" />} />
        </MetricGrid>
      </PageHero>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <SectionCard
          title={tr("Добавить или обновить правило", "Add or update permission")}
          description={tr("Создайте прямое правило, если стандартного профиля или группы недостаточно.", "Create a direct override when profile or group assignment is not enough.")}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Пользователь", "User")}</Label>
              <select
                value={newUserId}
                onChange={(event) => setNewUserId(Number(event.target.value))}
                className="enterprise-select"
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Функция", "Feature")}</Label>
              <select
                value={newFeature}
                onChange={(event) => setNewFeature(event.target.value)}
                className="enterprise-select"
              >
                {features.map((feature) => (
                  <option key={feature.value} value={feature.value}>
                    {feature.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Решение", "Decision")}</Label>
              <select
                value={newAllowed ? "1" : "0"}
                onChange={(event) => setNewAllowed(event.target.value === "1")}
                className="enterprise-select"
              >
                <option value="1">{tr("Разрешить", "Allow")}</option>
                <option value="0">{tr("Запретить", "Deny")}</option>
              </select>
            </div>
            <Button onClick={onCreate} className="w-full">{tr("Сохранить правило", "Save permission")}</Button>
          </div>
        </SectionCard>

        <SectionCard
          title={tr("Каталог правил", "Permission catalog")}
          description={tr("Фильтруйте явные правила по пользователю и функции перед изменением.", "Filter explicit permission rules by user and feature before changing them.")}
          actions={(
            <div className="flex flex-wrap gap-2">
              <select value={filterUserId} onChange={(event) => setFilterUserId(Number(event.target.value))} className="enterprise-select min-w-[180px]">
                <option value={0}>{tr("Все пользователи", "All users")}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.username}</option>
                ))}
              </select>
              <select value={filterFeature} onChange={(event) => setFilterFeature(event.target.value)} className="enterprise-select min-w-[220px]">
                <option value="">{tr("Все функции", "All features")}</option>
                {features.map((feature) => (
                  <option key={feature.value} value={feature.value}>{feature.label}</option>
                ))}
              </select>
            </div>
          )}
        >
          <div className="space-y-3">
            {filteredPermissions.map((permission) => (
              <div key={permission.id} className="rounded-2xl border border-border/70 bg-background/30 px-4 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-foreground">{permission.username}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${permission.allowed ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                        {permission.allowed ? tr("Разрешено", "Allowed") : tr("Запрещено", "Denied")}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">{permission.feature_display || permission.feature}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggleAllowed(permission.id, permission.allowed)}>
                      {tr("Переключить", "Toggle")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setDeleteTarget({ id: permission.id, username: permission.username, feature: permission.feature_display || permission.feature })}>
                      {tr("Удалить", "Delete")}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {!filteredPermissions.length && (
              <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                {tr("По выбранным фильтрам правила не найдены.", "No permissions match the selected filters.")}
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
        title={tr("Удалить правило", "Delete permission")}
        description={deleteTarget ? tr(`Удалить явное правило для "${deleteTarget.username}" по функции "${deleteTarget.feature}"?`, `Delete explicit permission for "${deleteTarget.username}" on "${deleteTarget.feature}"?`) : ""}
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
