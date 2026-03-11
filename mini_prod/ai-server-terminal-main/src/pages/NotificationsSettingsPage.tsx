import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bell,
  Bot,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Save,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell, SectionCard, StatusBadge } from "@/components/ui/page-shell";
import { useToast } from "@/hooks/use-toast";
import { studioNotifications, type NotificationConfig } from "@/lib/api";

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password field with show/hide toggle
// ---------------------------------------------------------------------------
function PasswordField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`pr-9 ${className || "h-8 text-xs"}`}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => setShow(!show)}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function TestButton({
  label,
  onTest,
  disabled,
}: {
  label: string;
  onTest: () => Promise<{ ok: boolean; message: string }>;
  disabled?: boolean;
}) {
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setState(null);
    try {
      const result = await onTest();
      setState(result);
    } catch (error: unknown) {
      setState({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={disabled || loading}
        className="h-7 gap-1.5 text-xs"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        {label}
      </Button>
      {state ? (
        <div
          className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
            state.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
        >
          {state.ok ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
          {state.message}
        </div>
      ) : null}
    </div>
  );
}

function DeliveryStatusRow({
  icon: Icon,
  title,
  description,
  ready,
  lang,
}: {
  icon: ElementType;
  title: string;
  description: string;
  ready: boolean;
  lang: "ru" | "en";
}) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);

  return (
    <div className="workspace-subtle flex items-start justify-between gap-3 rounded-2xl px-4 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/40">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs leading-5 text-muted-foreground">{description}</div>
        </div>
      </div>
      <StatusBadge
        label={ready ? tr("Готово", "Ready") : tr("Не настроено", "Not ready")}
        tone={ready ? "success" : "warning"}
        className="shrink-0"
      />
    </div>
  );
}

function HelpLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export default function NotificationsSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["studio", "notifications"],
    queryFn: studioNotifications.get,
  });

  const [form, setForm] = useState<Partial<NotificationConfig>>({});

  useEffect(() => {
    if (!cfg) return;

    const fixed = { ...cfg };
    const host = (cfg.smtp_host || "").toLowerCase();
    const login = (cfg.smtp_user || "").trim();

    if (cfg.notify_email && !cfg.notify_email.includes("@")) {
      if (host.includes("yandex")) fixed.notify_email = `${cfg.notify_email.trim()}@yandex.ru`;
      else if (host.includes("gmail")) fixed.notify_email = `${cfg.notify_email.trim()}@gmail.com`;
    }

    const from = (cfg.from_email || "").trim();
    const fromBroken = !from || from.toLowerCase().includes("noreply@") || from.includes("weuai.site");
    if (fromBroken && login) {
      if (host.includes("yandex") && !login.includes("@")) fixed.from_email = `WEU Platform <${login}@yandex.ru>`;
      else if (host.includes("gmail") && !login.includes("@"))
        fixed.from_email = `WEU Platform <${login}@gmail.com>`;
      else if (login.includes("@")) fixed.from_email = `WEU Platform <${login}>`;
    }

    setForm(fixed);
  }, [cfg]);

  const set = (key: keyof NotificationConfig, value: string) =>
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));

  const persistSettings = async () => {
    await studioNotifications.save(form);
    await queryClient.invalidateQueries({ queryKey: ["studio", "notifications"] });
  };

  const saveMutation = useMutation({
    mutationFn: persistSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "notifications"] });
      toast({ description: "Notification settings saved" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", description: error.message });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Notification Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure once — all pipelines use these credentials automatically
            </p>
          </div>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="gap-1.5"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-900/10 px-4 py-3 text-xs text-blue-300">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Settings are saved to <code>.notification_config.json</code> and override values from <code>.env</code>.
          Individual pipeline nodes can still override these global defaults.
        </span>
      </div>

      {/* ── Telegram ───────────────────────────────────────────────────── */}
      <Section
        icon={Bot}
        title="Telegram Bot"
        description="Receive update plans, approval requests and reports directly in Telegram"
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Bot Token</Label>
            <PasswordField
              value={form.telegram_bot_token || ""}
              onChange={(v) => set("telegram_bot_token", v)}
              placeholder="1234567890:AAFxxx... (from @BotFather)"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Chat ID</Label>
            <Input
              value={form.telegram_chat_id || ""}
              onChange={(e) => set("telegram_chat_id", e.target.value)}
              placeholder="123456789  (use @userinfobot to find yours)"
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs space-y-1.5">
            <p className="font-medium text-muted-foreground uppercase text-[10px] tracking-wide">Quick setup (2 min)</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Open Telegram → search <strong>@BotFather</strong> → /newbot → get token</li>
              <li>Start your new bot (send it /start)</li>
              <li>
                Find your Chat ID: open{" "}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  @userinfobot <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </li>
              <li>Paste both values above and save</li>
            </ol>
          </div>

          <TestButton
            label="Send Test Message"
            disabled={!form.telegram_bot_token || !form.telegram_chat_id}
            onTest={() => studioNotifications.testTelegram()}
          />
        </div>
      </Section>

      {/* ── Email ──────────────────────────────────────────────────────── */}
      <Section
        icon={Mail}
        title="Email (SMTP)"
        description="Send approval links, update plans and final reports by email"
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Your email (recipient)</Label>
            <Input
              type="email"
              value={form.notify_email || ""}
              onChange={(e) => set("notify_email", e.target.value)}
              placeholder="you@gmail.com"
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">All pipeline notifications will be sent to this address</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">SMTP Host</Label>
              <Input
                value={form.smtp_host || ""}
                onChange={(e) => set("smtp_host", e.target.value)}
                placeholder="smtp.gmail.com или smtp.yandex.ru"
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Яндекс: <code>smtp.yandex.ru</code>, порт <code>465</code>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Port</Label>
              <Input
                value={form.smtp_port || "587"}
                onChange={(e) => set("smtp_port", e.target.value)}
                placeholder="465 или 587"
                className="h-8 text-xs"
              />
            </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Login</Label>
            <Input
              value={form.smtp_user || ""}
              onChange={(e) => set("smtp_user", e.target.value)}
              placeholder="email@gmail.com или для Яндекса: часть до @"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Password / App Password</Label>
            <PasswordField
              value={form.smtp_password || ""}
              onChange={(v) => set("smtp_password", v)}
              placeholder="For Gmail — create an App Password (not your main password)"
            />
            <p className="text-[10px] text-muted-foreground">
              Gmail:{" "}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                App Password
              </a>
              {" · "}
              Яндекс:{" "}
              <a href="https://yandex.ru/support/yandex-360/customers/mail/ru/mail-clients/others" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                пароль приложения
              </a>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">From address (optional)</Label>
            <Input
              value={form.from_email || ""}
              onChange={(e) => set("from_email", e.target.value)}
              placeholder="WEU Platform <логин@yandex.ru>"
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Должен быть ваш реальный ящик на SMTP-сервере. Для Яндекса: <code>WEU Platform &lt;логин@yandex.ru&gt;</code>
            </p>
          </div>

          <TestButton
            label="Send Test Email"
            disabled={!form.smtp_user || !form.notify_email}
            onTest={() => studioNotifications.testEmail()}
          />
        </div>
      </Section>

      {/* ── General ────────────────────────────────────────────────────── */}
      <Section
        icon={ExternalLink}
        title="Server URL"
        description="Used in approval links sent via email and Telegram"
      >
        <div className="space-y-1.5">
          <Label className="text-xs">Public URL of this server</Label>
          <Input
            value={form.site_url || ""}
            onChange={(e) => set("site_url", e.target.value)}
            placeholder="https://your-server.example.com"
            className="h-8 text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            Approve/Reject links in notifications will point to this address.
            Example: <code>http://192.168.1.100:8000</code>
          </p>
        </div>
      </Section>

      {/* Save button (bottom) */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          size="lg"
          className="gap-2"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Settings
        </Button>
      </div>

      <SectionCard
        title={tr("Публичный URL", "Public URL")}
        description={tr(
          "Это адрес, который будут получать люди в email и Telegram при переходе по ссылкам подтверждения.",
          "This is the address people receive in email and Telegram when they follow approval links.",
        )}
        icon={<ExternalLink className="h-4 w-4 text-primary" />}
      >
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-2">
            <Label>{tr("Адрес приложения", "Application URL")}</Label>
            <Input
              value={form.site_url || ""}
              onChange={(event) => set("site_url", event.target.value)}
              placeholder="https://your-server.example.com"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {tr(
                "Используйте реальный внешний адрес, который могут открыть согласующие и операторы из своей сети.",
                "Use the real external address that approvers and operators can open from their network.",
              )}
            </p>
          </div>

          <div className="workspace-subtle rounded-2xl px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {tr("Как это работает", "How it works")}
            </div>
            <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
              <p>
                {tr(
                  "1. Сначала задайте публичный URL, иначе ссылки подтверждения будут вести не туда.",
                  "1. Set the public URL first, otherwise approval links will point to the wrong place.",
                )}
              </p>
              <p>
                {tr(
                  "2. Telegram удобен для быстрых подтверждений, email лучше оставить для отчётов и формальных уведомлений.",
                  "2. Telegram is best for quick approvals, while email is better for reports and formal notifications.",
                )}
              </p>
              <p>
                {tr(
                  "3. Эти значения работают как общие дефолты Studio и могут быть переопределены в конкретном workflow.",
                  "3. These values act as Studio-wide defaults and can still be overridden inside a specific workflow.",
                )}
              </p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={tr("Поведение по умолчанию", "Default behavior")}
        description={tr(
          "Коротко о том, когда эти настройки используются Studio.",
          "A quick summary of when Studio uses these settings.",
        )}
        icon={<Bell className="h-4 w-4 text-primary" />}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="workspace-subtle rounded-2xl px-4 py-4">
            <div className="text-sm font-medium text-foreground">{tr("Telegram", "Telegram")}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {tr(
                "Быстрые подтверждения, согласования планов и короткие алерты во время активного запуска.",
                "Quick approvals, plan confirmations and short alerts during an active run.",
              )}
            </p>
          </div>
          <div className="workspace-subtle rounded-2xl px-4 py-4">
            <div className="text-sm font-medium text-foreground">{tr("Email", "Email")}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {tr(
                "Отчёты, эскалации, длинные сообщения и ссылки для людей, которым нужен audit trail.",
                "Reports, escalation, longer messages and links for people who need an audit trail.",
              )}
            </p>
          </div>
          <div className="workspace-subtle rounded-2xl px-4 py-4">
            <div className="text-sm font-medium text-foreground">{tr("Переопределения", "Overrides")}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {tr(
                "Если отдельный pipeline требует другой канал, он может переопределить эти значения локально.",
                "If a specific pipeline needs a different channel, it can override these values locally.",
              )}
            </p>
          </div>
        </div>
      </SectionCard>
    </PageShell>
  );
}
