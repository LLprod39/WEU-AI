import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageShell({
  children,
  className,
  width = "7xl",
}: {
  children: ReactNode;
  className?: string;
  width?: "5xl" | "6xl" | "7xl";
}) {
  const widthClass =
    width === "5xl" ? "max-w-5xl" : width === "6xl" ? "max-w-6xl" : "max-w-7xl";

  return <div className={cn("mx-auto space-y-5 px-4 py-5 sm:px-6 lg:px-8", widthClass, className)}>{children}</div>;
}

export function PageGrid({
  children,
  className,
  sidebar,
}: {
  children: ReactNode;
  className?: string;
  sidebar?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-5",
        sidebar ? "xl:grid-cols-[minmax(0,1fr)_320px]" : "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHero({
  kicker,
  title,
  description,
  actions,
  className,
}: {
  kicker: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("px-1 py-1", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-4xl space-y-2">
          <div className="enterprise-kicker">{kicker}</div>
          <div className="space-y-1.5">
            <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground sm:text-[1.55rem]">{title}</h1>
            <div className="max-w-3xl text-sm leading-5 text-muted-foreground">{description}</div>
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">{actions}</div> : null}
      </div>
    </section>
  );
}

export function MetricGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-wrap gap-2", className)}>{children}</div>;
}

export function MetricCard({
  label,
  value,
  description,
  icon,
  className,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  className?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-500/25 bg-emerald-500/8"
      : tone === "warning"
        ? "border-amber-500/25 bg-amber-500/8"
        : tone === "danger"
          ? "border-red-500/25 bg-red-500/8"
          : tone === "info"
            ? "border-primary/25 bg-primary/8"
            : "border-border/80 bg-background/35";

  return (
    <div className={cn("inline-flex min-h-11 min-w-[200px] max-w-full items-center gap-2.5 rounded-[0.95rem] border px-3 py-2.5", toneClass, className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/40">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <span className="shrink-0 text-sm font-semibold tracking-[-0.03em] text-foreground">{value}</span>
          </div>
          <div className="hidden truncate text-[11px] leading-4 text-muted-foreground 2xl:block">{description}</div>
        </div>
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  icon,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("enterprise-panel overflow-hidden rounded-[1rem]", className)}>
      <div className="flex flex-col gap-3 border-b border-white/[0.04] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          {icon ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary/40">
              {icon}
            </div>
          ) : null}
          <div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            {description ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn("px-5 py-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("enterprise-filterbar", className)}>{children}</div>;
}

export function FilterGroup({
  label,
  description,
  children,
  className,
}: {
  label?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {label ? <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div> : null}
      {description ? <div className="text-xs leading-5 text-muted-foreground">{description}</div> : null}
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  hint,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("enterprise-empty", className)}>
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/35 text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <div className="space-y-2">
        <div className="text-base font-semibold text-foreground">{title}</div>
        <div className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      {hint ? <div className="rounded-xl bg-background/30 px-4 py-3 text-xs leading-5 text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function StatusBadge({
  label,
  tone = "neutral",
  dot = true,
  className,
}: {
  label: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  dot?: boolean;
  className?: string;
}) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-500/12 text-emerald-300"
      : tone === "warning"
        ? "bg-amber-500/12 text-amber-300"
        : tone === "danger"
          ? "bg-red-500/12 text-red-300"
          : tone === "info"
            ? "bg-primary/12 text-primary"
            : "bg-secondary/45 text-muted-foreground";
  const dotClass =
    tone === "success"
      ? "bg-emerald-400"
      : tone === "warning"
        ? "bg-amber-400"
        : tone === "danger"
          ? "bg-red-400"
          : tone === "info"
            ? "bg-primary"
            : "bg-muted-foreground";

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", toneClass, className)}>
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} /> : null}
      {label}
    </span>
  );
}
