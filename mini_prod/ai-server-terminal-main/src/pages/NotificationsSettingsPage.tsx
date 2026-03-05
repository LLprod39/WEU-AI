import { useState, useEffect, type ElementType, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  Mail,
  Save,
  Send,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  ExternalLink,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { studioNotifications, type NotificationConfig } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ElementType;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="enterprise-panel rounded-md p-6 sm:p-7 space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function ReadinessCard({
  title,
  value,
  description,
  ready,
  lang,
}: {
  title: string;
  value: string;
  description: string;
  ready: boolean;
  lang: "ru" | "en";
}) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  return (
    <div className="enterprise-stat rounded-md px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
          <p className="mt-3 text-lg font-semibold text-foreground">{value}</p>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${ready ? "bg-green-500/15 text-green-300" : "bg-amber-500/15 text-amber-300"}`}>
          {ready ? tr("Готово", "Ready") : tr("Требует настройки", "Needs setup")}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{description}</p>
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
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`pr-11 ${className || ""}`}
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        onClick={() => setShow(!show)}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test button with result display
// ---------------------------------------------------------------------------
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
      const res = await onTest();
      setState(res);
    } catch (e: unknown) {
      setState({ ok: false, message: e instanceof Error ? e.message : String(e) });
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
        className="gap-2"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {label}
      </Button>
      {state && (
        <div
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
            state.ok
              ? "bg-green-900/20 border border-green-600/30 text-green-300"
              : "bg-red-900/20 border border-red-600/30 text-red-300"
          }`}
        >
          {state.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {state.message}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
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

    // Подставить полный email получателя, если указан только логин
    if (cfg.notify_email && !cfg.notify_email.includes("@")) {
      if (host.includes("yandex")) fixed.notify_email = `${cfg.notify_email.trim()}@yandex.ru`;
      else if (host.includes("gmail")) fixed.notify_email = `${cfg.notify_email.trim()}@gmail.com`;
    }

    // Подставить корректный From для Яндекса/ Gmail, если поле пустое или некорректное
    const from = (cfg.from_email || "").trim();
    const fromBroken = !from || from.toLowerCase().includes("noreply@") || from.includes("weuai.site");
    if (fromBroken && login) {
      if (host.includes("yandex") && !login.includes("@"))
        fixed.from_email = `WEU Platform <${login}@yandex.ru>`;
      else if (host.includes("gmail") && !login.includes("@"))
        fixed.from_email = `WEU Platform <${login}@gmail.com>`;
      else if (login.includes("@"))
        fixed.from_email = `WEU Platform <${login}>`;
    }

    setForm(fixed);
  }, [cfg]);

  const set = (key: keyof NotificationConfig, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: () => studioNotifications.save(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "notifications"] });
      toast({ description: tr("Настройки уведомлений сохранены", "Notification settings saved") });
    },
    onError: (e: Error) => toast({ variant: "destructive", description: e.message }),
  });

  const telegramReady = Boolean(form.telegram_bot_token && form.telegram_chat_id);
  const emailReady = Boolean(
    form.notify_email && form.smtp_host && form.smtp_user && form.smtp_password
  );
  const siteUrlReady = Boolean(form.site_url);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> {tr("Загрузка...", "Loading…")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <section className="enterprise-panel rounded-md px-6 py-6 sm:px-7 sm:py-7">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="enterprise-kicker">{tr("Контроль доставки", "Delivery Control")}</div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">{tr("Настройки уведомлений", "Notification Settings")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {tr(
                  "Настройте один раз, и Studio будет использовать эти каналы для запросов подтверждения, планов обновлений, сводок и операционных алертов во всех пайплайнах.",
                  "Configure once and let Studio reuse these channels for approval requests, update plans, summaries and operational alerts across all pipelines.",
                )}
              </p>
            </div>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {tr("Сохранить настройки уведомлений", "Save notification settings")}
          </Button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <ReadinessCard
            title={tr("Telegram", "Telegram")}
            value={telegramReady ? tr("Подключено", "Connected") : tr("Не настроено", "Not configured")}
            description={tr("Используйте токен бота и chat ID, чтобы получать обновления рантайма прямо в Telegram.", "Use a bot token and chat ID to receive runtime updates directly in Telegram.")}
            ready={telegramReady}
            lang={lang}
          />
          <ReadinessCard
            title={tr("Email", "Email")}
            value={emailReady ? tr("Подключено", "Connected") : tr("Нужен SMTP", "Needs SMTP")}
            description={tr("Ссылки подтверждения, отчёты и эскалации зависят от рабочего SMTP-профиля.", "Approval links, reports and escalation notices depend on a working SMTP profile.")}
            ready={emailReady}
            lang={lang}
          />
          <ReadinessCard
            title={tr("Публичный URL", "Public URL")}
            value={siteUrlReady ? tr("Указан", "Present") : tr("Отсутствует", "Missing")}
            description={tr("Ссылки уведомлений должны вести на адрес, который операторы реально могут открыть.", "Notification links must point to a routable URL that operators can actually open.")}
            ready={siteUrlReady}
            lang={lang}
          />
        </div>

        <div className="mt-6 rounded-md border border-blue-500/25 bg-blue-500/10 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/15">
              <Info className="h-4 w-4 text-blue-300" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-100">{tr("Как работает глобальная доставка", "How global delivery works")}</p>
              <p className="text-sm leading-6 text-blue-200/90">
                {tr("Настройки сохраняются в ", "Settings are saved to ")}<code>.notification_config.json</code>{tr(" и переопределяют значения из ", " and override values from ")}<code>.env</code>.
                {tr(" Отдельные ноды пайплайна могут переопределять эти значения, если workflow нужен отдельный канал.", " Individual pipeline nodes can still override these defaults if a workflow needs a dedicated channel.")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
      <Section
        icon={Bot}
        title={tr("Telegram-бот", "Telegram Bot")}
        description={tr("Получайте планы обновлений, запросы подтверждения и отчёты прямо в Telegram", "Receive update plans, approval requests and reports directly in Telegram")}
      >
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{tr("Токен бота", "Bot Token")}</Label>
            <PasswordField
              value={form.telegram_bot_token || ""}
              onChange={(v) => set("telegram_bot_token", v)}
              placeholder={tr("1234567890:AAFxxx... (из @BotFather)", "1234567890:AAFxxx... (from @BotFather)")}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{tr("Chat ID", "Chat ID")}</Label>
            <Input
              value={form.telegram_chat_id || ""}
              onChange={(e) => set("telegram_chat_id", e.target.value)}
              placeholder={tr("123456789  (узнать можно через @userinfobot)", "123456789  (use @userinfobot to find yours)")}
              className="font-mono"
            />
          </div>

          <div className="rounded-md border border-border bg-background/35 p-4 text-sm space-y-2">
            <p className="font-medium text-muted-foreground uppercase text-[11px] tracking-[0.14em]">{tr("Быстрая настройка", "Quick setup")}</p>
            <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground leading-6">
              <li>{tr("Откройте Telegram → найдите ", "Open Telegram -> search ")}<strong>@BotFather</strong>{tr(" → /newbot → получите токен", " -> /newbot -> get token")}</li>
              <li>{tr("Запустите нового бота (отправьте /start)", "Start your new bot (send it /start)")}</li>
              <li>
                {tr("Узнайте ваш Chat ID: откройте ", "Find your Chat ID: open ")}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  @userinfobot <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </li>
              <li>{tr("Вставьте оба значения выше и сохраните", "Paste both values above and save")}</li>
            </ol>
          </div>

          <TestButton
            label={tr("Отправить тестовое сообщение", "Send Test Message")}
            disabled={!form.telegram_bot_token || !form.telegram_chat_id}
            onTest={() => studioNotifications.testTelegram()}
          />
        </div>
      </Section>

      {/* ── Email ──────────────────────────────────────────────────────── */}
      <Section
        icon={Mail}
        title={tr("Email (SMTP)", "Email (SMTP)")}
        description={tr("Отправляйте ссылки подтверждения, планы и финальные отчёты по email", "Send approval links, update plans and final reports by email")}
      >
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{tr("Email получателя", "Recipient email")}</Label>
            <Input
              type="email"
              value={form.notify_email || ""}
              onChange={(e) => set("notify_email", e.target.value)}
              placeholder="you@gmail.com"
            />
            <p className="text-xs text-muted-foreground">{tr("Все уведомления пайплайнов будут отправляться на этот адрес.", "All pipeline notifications will be sent to this address.")}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("SMTP Host", "SMTP Host")}</Label>
              <Input
                value={form.smtp_host || ""}
                onChange={(e) => set("smtp_host", e.target.value)}
                placeholder={tr("smtp.gmail.com или smtp.yandex.ru", "smtp.gmail.com or smtp.yandex.ru")}
              />
              <p className="text-xs text-muted-foreground">
                {tr("Яндекс: ", "Yandex: ")}<code>smtp.yandex.ru</code>, {tr("порт", "port")} <code>465</code>
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{tr("Порт", "Port")}</Label>
              <Input
                value={form.smtp_port || "587"}
                onChange={(e) => set("smtp_port", e.target.value)}
                placeholder={tr("465 или 587", "465 or 587")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{tr("Логин", "Login")}</Label>
            <Input
              value={form.smtp_user || ""}
              onChange={(e) => set("smtp_user", e.target.value)}
              placeholder={tr("email@gmail.com или для Яндекса: часть до @", "email@gmail.com or for Yandex: part before @")}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{tr("Пароль / App Password", "Password / App Password")}</Label>
            <PasswordField
              value={form.smtp_password || ""}
              onChange={(v) => set("smtp_password", v)}
              placeholder={tr("Для Gmail используйте App Password, а не основной пароль", "For Gmail — create an App Password (not your main password)")}
            />
            <p className="text-xs text-muted-foreground">
              Gmail:{" "}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                App Password
              </a>
              {" · "}
              {tr("Яндекс", "Yandex")}:{" "}
              <a href="https://yandex.ru/support/yandex-360/customers/mail/ru/mail-clients/others" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {tr("пароль приложения", "app password")}
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{tr("Адрес отправителя", "From address")}</Label>
            <Input
              value={form.from_email || ""}
              onChange={(e) => set("from_email", e.target.value)}
              placeholder={tr("WEU Platform <логин@yandex.ru>", "WEU Platform <login@yandex.ru>")}
            />
            <p className="text-xs text-muted-foreground">
              {tr("Должен быть ваш реальный ящик на SMTP-сервере. Для Яндекса:", "Must be a real mailbox on your SMTP server. For Yandex:")} <code>{tr("WEU Platform <логин@yandex.ru>", "WEU Platform <login@yandex.ru>")}</code>
            </p>
          </div>

          <TestButton
            label={tr("Отправить тестовый email", "Send Test Email")}
            disabled={!form.smtp_user || !form.notify_email}
            onTest={() => studioNotifications.testEmail()}
          />
        </div>
      </Section>

      {/* ── General ────────────────────────────────────────────────────── */}
      <Section
        icon={ExternalLink}
        title={tr("URL сервера", "Server URL")}
        description={tr("Используется в ссылках подтверждения в email и Telegram", "Used in approval links sent via email and Telegram")}
      >
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">{tr("Публичный URL этого сервера", "Public URL of this server")}</Label>
          <Input
            value={form.site_url || ""}
            onChange={(e) => set("site_url", e.target.value)}
            placeholder="https://your-server.example.com"
          />
          <p className="text-xs text-muted-foreground">
            {tr("Ссылки Approve/Reject в уведомлениях будут вести на этот адрес.", "Approve/Reject links in notifications will point to this address.")}
            {tr(" Пример:", " Example:")} <code>http://192.168.1.100:8000</code>
          </p>
        </div>
      </Section>

          <div className="flex justify-end pt-1">
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
              {tr("Сохранить настройки", "Save settings")}
            </Button>
          </div>
        </div>

        <aside className="space-y-6">
          <section className="enterprise-panel rounded-md p-6 sticky top-24">
            <div className="enterprise-kicker">{tr("Чеклист оператора", "Operator Checklist")}</div>
            <h2 className="mt-3 text-xl font-semibold text-foreground">{tr("Готовность каналов", "Channel readiness")}</h2>
            <div className="mt-5 space-y-3">
              <div className="rounded-md border border-border/70 bg-background/35 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{tr("Доставка в Telegram", "Telegram delivery")}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${telegramReady ? "bg-green-500/15 text-green-300" : "bg-amber-500/15 text-amber-300"}`}>
                    {telegramReady ? tr("Готово", "Ready") : tr("Ожидание", "Pending")}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {tr("Лучше всего подходит для быстрых подтверждений, согласования планов и оперативных алертов во время активных запусков.", "Best for fast approvals, plan confirmations and operational alerts during active runs.")}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{tr("Доставка по email", "Email delivery")}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${emailReady ? "bg-green-500/15 text-green-300" : "bg-amber-500/15 text-amber-300"}`}>
                    {emailReady ? tr("Готово", "Ready") : tr("Ожидание", "Pending")}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {tr("Нужна для детальных отчётов, ссылок подтверждения и длинного audit trail для заинтересованных сторон.", "Required for detailed reports, approval links and longer audit trails shared with stakeholders.")}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{tr("Публичные ссылки", "Public links")}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${siteUrlReady ? "bg-green-500/15 text-green-300" : "bg-amber-500/15 text-amber-300"}`}>
                    {siteUrlReady ? tr("Готово", "Ready") : tr("Ожидание", "Pending")}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {tr("Подтверждающие должны иметь доступ к сгенерированным URL из своей рабочей сетевой зоны.", "Approvers must be able to open the generated URLs from the network segment they actually use.")}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-md border border-border/70 bg-background/30 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr("Рекомендуемый порядок", "Recommended rollout")}</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>{tr("1. Сначала настройте публичный URL сервера, чтобы ссылки подтверждения были валидны.", "1. Configure the public server URL first so approval links are valid.")}</li>
                <li>{tr("2. Включите Telegram для быстрого обратного цикла с операторами.", "2. Enable Telegram for fast operator feedback loops.")}</li>
                <li>{tr("3. Добавьте SMTP для формальных отчётов и эскалационных сценариев.", "3. Add SMTP for formal reports and escalation workflows.")}</li>
              </ul>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

