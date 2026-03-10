import { useEffect, useState, type ElementType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useI18n } from "@/lib/i18n";

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
        className={`pr-11 ${className || ""}`}
      />
      <button
        type="button"
        aria-label={show ? "Hide value" : "Show value"}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        onClick={() => setShow((prev) => !prev)}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={run} disabled={disabled || loading} className="gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {label}
      </Button>
      {state ? (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
            state.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
        >
          {state.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{state.message}</span>
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
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
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
      toast({ description: tr("Настройки уведомлений сохранены", "Notification settings saved") });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", description: error.message });
    },
  });

  const telegramReady = Boolean(form.telegram_bot_token && form.telegram_chat_id);
  const emailReady = Boolean(form.notify_email && form.smtp_host && form.smtp_user && form.smtp_password);
  const siteUrlReady = Boolean(form.site_url);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {tr("Загрузка...", "Loading...")}
      </div>
    );
  }

  return (
    <PageShell width="6xl" className="space-y-5">
      <section className="workspace-panel px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="enterprise-kicker">{tr("Доставка", "Delivery")}</div>
            <h1 className="text-[1.7rem] font-semibold tracking-[-0.05em] text-foreground">
              {tr("Настройки уведомлений", "Notification settings")}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {tr(
                "Один экран, где вы задаёте общие каналы для Studio: быстрые подтверждения в Telegram, формальные отчёты по email и корректные публичные ссылки.",
                "One place to set the default delivery channels for Studio: fast approvals in Telegram, formal reports by email, and valid public links.",
              )}
            </p>
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {tr("Сохранить", "Save")}
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <DeliveryStatusRow
            icon={Bot}
            title={tr("Telegram", "Telegram")}
            description={tr(
              "Используйте для быстрых подтверждений и коротких алертов.",
              "Use for quick approvals and short alerts.",
            )}
            ready={telegramReady}
            lang={lang}
          />
          <DeliveryStatusRow
            icon={Mail}
            title={tr("Email", "Email")}
            description={tr(
              "Используйте для отчётов, эскалаций и длинных уведомлений.",
              "Use for reports, escalation and longer notifications.",
            )}
            ready={emailReady}
            lang={lang}
          />
          <DeliveryStatusRow
            icon={ExternalLink}
            title={tr("Публичный URL", "Public URL")}
            description={tr(
              "Сюда будут вести ссылки Approve/Reject и другие внешние переходы.",
              "Approve/Reject links and other external links will point here.",
            )}
            ready={siteUrlReady}
            lang={lang}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title={tr("Telegram", "Telegram")}
          description={tr(
            "Самый простой канал для коротких подтверждений во время активных запусков.",
            "The simplest channel for short approvals during active runs.",
          )}
          icon={<Bot className="h-4 w-4 text-primary" />}
        >
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{tr("Токен бота", "Bot token")}</Label>
                <PasswordField
                  value={form.telegram_bot_token || ""}
                  onChange={(value) => set("telegram_bot_token", value)}
                  placeholder={tr("Из @BotFather", "From @BotFather")}
                />
              </div>
              <div className="space-y-2">
                <Label>{tr("Chat ID", "Chat ID")}</Label>
                <Input
                  value={form.telegram_chat_id || ""}
                  onChange={(event) => set("telegram_chat_id", event.target.value)}
                  placeholder={tr("Например: 123456789", "Example: 123456789")}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="workspace-subtle rounded-2xl px-4 py-3 text-sm leading-6 text-muted-foreground">
              {tr("Создайте бота через ", "Create a bot via ")}
              <HelpLink href="https://t.me/BotFather">@BotFather</HelpLink>
              {tr(" и узнайте chat ID через ", " and find the chat ID via ")}
              <HelpLink href="https://t.me/userinfobot">@userinfobot</HelpLink>
              .
            </div>

            <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
              <TestButton
                label={tr("Проверить Telegram", "Test Telegram")}
                disabled={!form.telegram_bot_token || !form.telegram_chat_id}
                onTest={async () => {
                  await persistSettings();
                  return studioNotifications.testTelegram();
                }}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {tr(
                  "Перед тестом текущие значения будут сохранены, чтобы сообщение ушло с актуальными настройками.",
                  "The current values are saved before the test so the message uses the latest settings.",
                )}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title={tr("Email", "Email")}
          description={tr(
            "Канал для отчётов, ссылок подтверждения и более формальной доставки.",
            "The channel for reports, approval links and more formal delivery.",
          )}
          icon={<Mail className="h-4 w-4 text-primary" />}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tr("Email получателя", "Recipient email")}</Label>
              <Input
                type="email"
                value={form.notify_email || ""}
                onChange={(event) => set("notify_email", event.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{tr("SMTP host", "SMTP host")}</Label>
                <Input
                  value={form.smtp_host || ""}
                  onChange={(event) => set("smtp_host", event.target.value)}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div className="space-y-2">
                <Label>{tr("Порт", "Port")}</Label>
                <Input
                  value={form.smtp_port || "587"}
                  onChange={(event) => set("smtp_port", event.target.value)}
                  placeholder="587"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{tr("Логин", "Login")}</Label>
                <Input
                  value={form.smtp_user || ""}
                  onChange={(event) => set("smtp_user", event.target.value)}
                  placeholder="user@gmail.com"
                />
              </div>
              <div className="space-y-2">
                <Label>{tr("Пароль / App Password", "Password / App Password")}</Label>
                <PasswordField
                  value={form.smtp_password || ""}
                  onChange={(value) => set("smtp_password", value)}
                  placeholder={tr("Для Gmail лучше использовать App Password", "Prefer an App Password for Gmail")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{tr("Адрес отправителя", "From address")}</Label>
              <Input
                value={form.from_email || ""}
                onChange={(event) => set("from_email", event.target.value)}
                placeholder="WEU Platform <user@example.com>"
              />
            </div>

            <div className="workspace-subtle rounded-2xl px-4 py-3 text-sm leading-6 text-muted-foreground">
              Gmail: <HelpLink href="https://myaccount.google.com/apppasswords">App Password</HelpLink>
              {" · "}
              {tr("Яндекс", "Yandex")}:{" "}
              <HelpLink href="https://yandex.ru/support/yandex-360/customers/mail/ru/mail-clients/others">
                {tr("пароль приложения", "app password")}
              </HelpLink>
            </div>

            <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
              <TestButton
                label={tr("Проверить email", "Test email")}
                disabled={!form.notify_email || !form.smtp_host || !form.smtp_user || !form.smtp_password}
                onTest={async () => {
                  await persistSettings();
                  return studioNotifications.testEmail();
                }}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {tr(
                  "Тест сохраняет форму и отправляет письмо на адрес получателя, указанный выше.",
                  "The test saves the form and sends an email to the recipient address above.",
                )}
              </p>
            </div>
          </div>
        </SectionCard>
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
