import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, ArrowLeft, BookOpen, Bot, CheckCircle2, Loader2, Search, Server, Shield, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  studioSkills,
  type StudioSkill,
  type StudioSkillScaffoldPayload,
  type StudioSkillTemplate,
  type StudioSkillValidationResponse,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const SAFETY_LEVELS = ["low", "standard", "medium", "high", "critical"] as const;

type SkillWizardState = {
  name: string;
  description: string;
  slug: string;
  service: string;
  category: string;
  safety_level: string;
  ui_hint: string;
  tags_text: string;
  guardrail_summary_text: string;
  recommended_tools_text: string;
  runtime_policy_text: string;
  with_scripts: boolean;
  with_references: boolean;
  with_assets: boolean;
  force: boolean;
};

function listToCsv(items?: string[]) {
  return (items || []).join(", ");
}

function parseCsvInput(text: string) {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugifySkillName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
}

function createWizardState(template?: StudioSkillTemplate | null): SkillWizardState {
  const defaults = template?.defaults || {};
  const name = defaults.name || "";
  return {
    name,
    description: defaults.description || "",
    slug: slugifySkillName(name),
    service: defaults.service || "",
    category: defaults.category || "",
    safety_level: defaults.safety_level || "standard",
    ui_hint: defaults.ui_hint || "",
    tags_text: listToCsv(defaults.tags),
    guardrail_summary_text: listToCsv(defaults.guardrail_summary),
    recommended_tools_text: listToCsv(defaults.recommended_tools),
    runtime_policy_text: JSON.stringify(defaults.runtime_policy || {}, null, 2),
    with_scripts: false,
    with_references: true,
    with_assets: false,
    force: false,
  };
}

function parseRuntimePolicy(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Runtime policy must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function SkillMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        code: ({ className, children }) => {
          const code = String(children).replace(/\n$/, "");
          if ((className || "").includes("language-") || code.includes("\n")) {
            return (
              <code className="block whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 font-mono text-[11px] leading-5 text-foreground">
                {code}
              </code>
            );
          }
          return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>;
        },
        h1: ({ children }) => <h1 className="text-base font-semibold text-foreground">{children}</h1>,
        h2: ({ children }) => <h2 className="mt-4 text-sm font-semibold text-foreground">{children}</h2>,
        h3: ({ children }) => <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>,
        p: ({ children }) => <p className="text-xs leading-6 text-muted-foreground">{children}</p>,
        ul: ({ children }) => <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">{children}</blockquote>
        ),
        hr: () => <hr className="my-3 border-border" />,
        pre: ({ children }) => <pre className="overflow-auto">{children}</pre>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function SkillCard({
  skill,
  isSelected,
  onSelect,
  lang,
}: {
  skill: StudioSkill;
  isSelected: boolean;
  onSelect: () => void;
  lang: "ru" | "en";
}) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[22px] border px-4 py-4 text-left transition-[border-color,background-color,box-shadow] ${
        isSelected
          ? "border-primary/45 bg-primary/8 shadow-[0_18px_48px_-34px_rgba(37,99,235,0.7)]"
          : "border-border bg-card/70 hover:border-primary/35 hover:bg-muted/20"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{skill.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            {skill.service && <span>{skill.service}</span>}
            {skill.category && <span>· {skill.category}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {skill.runtime_enforced && <Badge variant="secondary" className="text-[9px]">{tr("runtime enforced", "runtime enforced")}</Badge>}
          {skill.safety_level && <Badge variant="outline" className="text-[9px]">{skill.safety_level}</Badge>}
        </div>
      </div>
      {skill.description && <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{skill.description}</p>}
      {skill.ui_hint && <p className="mt-2 text-[10px] leading-5 text-muted-foreground">{skill.ui_hint}</p>}
      {skill.guardrail_summary?.length > 0 && (
        <div className="mt-3 space-y-1">
          {skill.guardrail_summary.slice(0, 2).map((item) => (
            <p key={item} className="text-[10px] text-muted-foreground">• {item}</p>
          ))}
        </div>
      )}
      {skill.tags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {skill.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function TemplateCard({
  template,
  onUse,
}: {
  template: StudioSkillTemplate;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onUse}
      className="rounded-[22px] border border-border bg-card/70 p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/40 hover:bg-muted/20"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/15 bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{template.name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {template.defaults.service && <Badge variant="secondary" className="text-[10px]">{template.defaults.service}</Badge>}
            {template.defaults.safety_level && <Badge variant="outline" className="text-[10px]">{template.defaults.safety_level}</Badge>}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{template.description}</p>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">{template.summary}</p>
    </button>
  );
}

function ValidationSummaryCard({ report }: { report: StudioSkillValidationResponse }) {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const ok = report.summary.is_valid;
  return (
    <Card className={ok ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5"}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          {ok ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
          <div>
            <p className="text-sm font-medium">{ok ? tr("Библиотека скиллов прошла валидацию", "Skill library passed validation") : tr("Библиотека скиллов требует проверки", "Skill library needs review")}</p>
            <p className="text-[11px] text-muted-foreground">
              {report.summary.skills} {tr("скиллов", "skill(s)")}, {report.summary.errors} {tr("ошибок", "error(s)")}, {report.summary.warnings} {tr("предупреждений", "warning(s)")}
            </p>
          </div>
        </div>
        <Badge variant={ok ? "secondary" : "outline"} className="text-[10px]">
          {report.summary.strict ? tr("строгий режим", "strict mode") : tr("стандартный режим", "standard mode")}
        </Badge>
      </CardContent>
    </Card>
  );
}

export default function StudioSkillsPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("__all__");
  const [selectedSlug, setSelectedSlug] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [selectedTemplateSlug, setSelectedTemplateSlug] = useState("__none__");
  const [wizard, setWizard] = useState<SkillWizardState>(() => createWizardState(null));
  const [slugTouched, setSlugTouched] = useState(false);
  const [validationReport, setValidationReport] = useState<StudioSkillValidationResponse | null>(null);
  const [strictValidation, setStrictValidation] = useState(false);

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ["studio", "skills"],
    queryFn: studioSkills.list,
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["studio", "skill-templates"],
    queryFn: studioSkills.templates,
  });

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.slug === selectedTemplateSlug) || null,
    [templates, selectedTemplateSlug],
  );

  const services = Array.from(new Set(skills.map((skill) => skill.service).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const filteredSkills = skills.filter((skill) => {
    const haystack = [skill.name, skill.slug, skill.description, skill.service, skill.category, ...(skill.tags || [])]
      .join(" ")
      .toLowerCase();
    const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase());
    const matchesService = serviceFilter === "__all__" || skill.service === serviceFilter;
    return matchesSearch && matchesService;
  });
  const filteredSignature = filteredSkills.map((skill) => skill.slug).join("|");
  const runtimeEnforcedCount = skills.filter((skill) => skill.runtime_enforced).length;
  const serviceCount = new Set(skills.map((skill) => skill.service).filter(Boolean)).size;

  const scaffoldMutation = useMutation({
    mutationFn: (payload: StudioSkillScaffoldPayload) => studioSkills.scaffold(payload),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "skills"] });
      queryClient.invalidateQueries({ queryKey: ["studio", "skills", response.skill.slug] });
      setSelectedSlug(response.skill.slug);
      setCreateOpen(false);
      toast({
        description:
          response.validation.warnings.length > 0
            ? tr(`Скилл создан с предупреждениями: ${response.validation.warnings.length}`, `Skill created with ${response.validation.warnings.length} warning(s)`)
            : tr("Скилл создан", "Skill created"),
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", description: error.message });
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => studioSkills.validate(undefined, strictValidation),
    onSuccess: (response) => {
      setValidationReport(response);
      setValidateOpen(true);
      toast({
        description:
          response.summary.errors > 0
            ? tr(`Валидация нашла ошибок: ${response.summary.errors}`, `Validation found ${response.summary.errors} error(s)`)
            : response.summary.warnings > 0
              ? tr(`Валидация нашла предупреждений: ${response.summary.warnings}`, `Validation found ${response.summary.warnings} warning(s)`)
              : tr("Библиотека скиллов прошла валидацию", "Skill library passed validation"),
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", description: error.message });
    },
  });

  useEffect(() => {
    if (!filteredSkills.length) {
      if (selectedSlug) setSelectedSlug("");
      return;
    }
    if (!selectedSlug || !filteredSkills.some((skill) => skill.slug === selectedSlug)) {
      setSelectedSlug(filteredSkills[0].slug);
    }
  }, [filteredSignature, selectedSlug]);

  const { data: selectedSkill, isFetching: isFetchingSkill } = useQuery({
    queryKey: ["studio", "skills", selectedSlug],
    queryFn: () => studioSkills.get(selectedSlug),
    enabled: !!selectedSlug,
  });

  const openCreateDialog = (template?: StudioSkillTemplate | null) => {
    setSelectedTemplateSlug(template?.slug || "__none__");
    setWizard(createWizardState(template || null));
    setSlugTouched(false);
    setCreateOpen(true);
  };

  const submitWizard = () => {
    let runtimePolicy: Record<string, unknown>;
    try {
      runtimePolicy = parseRuntimePolicy(wizard.runtime_policy_text);
    } catch (error) {
      toast({
        variant: "destructive",
        description: error instanceof Error ? error.message : tr("Runtime policy должен быть валидным JSON-объектом", "Runtime policy must be valid JSON"),
      });
      return;
    }

    const payload: StudioSkillScaffoldPayload = {
      template_slug: selectedTemplateSlug !== "__none__" ? selectedTemplateSlug : undefined,
      name: wizard.name.trim(),
      description: wizard.description.trim(),
      slug: wizard.slug.trim() || undefined,
      service: wizard.service.trim() || undefined,
      category: wizard.category.trim() || undefined,
      safety_level: wizard.safety_level,
      ui_hint: wizard.ui_hint.trim() || undefined,
      tags: parseCsvInput(wizard.tags_text),
      guardrail_summary: parseCsvInput(wizard.guardrail_summary_text),
      recommended_tools: parseCsvInput(wizard.recommended_tools_text),
      runtime_policy: runtimePolicy,
      with_scripts: wizard.with_scripts,
      with_references: wizard.with_references,
      with_assets: wizard.with_assets,
      force: wizard.force,
    };
    scaffoldMutation.mutate(payload);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 py-6">
        <div className="enterprise-panel rounded-md px-6 py-6 md:px-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-md" onClick={() => navigate("/studio")}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="enterprise-kicker">{tr("Корпоративная библиотека скиллов", "Corporate Skill Library")}</span>
              </div>
              <div className="space-y-2">
                <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-foreground md:text-[2rem]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  {tr("Каталог скиллов", "Skill Catalog")}
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-[15px]">
                  {tr(
                    "Скиллы задают корпоративный плейбук для сервисов на MCP: discovery, preflight, pinned context, guardrails и требования к отчётности.",
                    "Skills define the company playbook for MCP-backed services: discovery, preflight, pinned context, guardrails, and reporting expectations.",
                  )}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Скиллы", "Skills")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{skills.length}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{tr("Версионируемые корпоративные плейбуки в Studio.", "Versioned corporate playbooks available in Studio.")}</p>
                </div>
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Рантайм", "Runtime")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{runtimeEnforcedCount}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{tr("Скиллы, у которых включена enforced runtime-политика.", "Skills currently backed by enforced runtime policy.")}</p>
                </div>
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Сервисы", "Services")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{serviceCount}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{tr("Уникальные сервисные домены, покрытые библиотекой скиллов.", "Distinct service domains covered by the skill library.")}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <Button variant="outline" size="sm" onClick={() => navigate("/studio/mcp")} className="h-9 gap-1.5 rounded-md px-3">
                <Server className="h-3.5 w-3.5" />
                {tr("MCP Реестр", "MCP Registry")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => validateMutation.mutate()} className="h-9 gap-1.5 rounded-md px-3">
                {validateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                {tr("Проверить библиотеку", "Validate Library")}
              </Button>
              <Button size="sm" onClick={() => openCreateDialog()} className="h-9 gap-1.5 rounded-md px-4">
                <WandSparkles className="h-3.5 w-3.5" />
                {tr("Новый скилл", "New Skill")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/studio/agents")} className="h-9 gap-1.5 rounded-md px-3">
                <Bot className="h-3.5 w-3.5" />
                {tr("Конфиги агентов", "Agent Configs")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-8">
        <div className="space-y-4">
          {validationReport && <ValidationSummaryCard report={validationReport} />}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
            <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              <Card className="overflow-hidden rounded-md border-primary/20 bg-primary/5">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">{tr("Как собрать корпоративного бота", "How to assemble a corporate bot")}</p>
                  </div>
                  <div className="space-y-1 text-[11px] leading-6 text-muted-foreground">
                    <p>{tr("1. MCP даёт боту «руки»: реальные инструменты для Keycloak, GitLab, Kubernetes, PostgreSQL и других сервисов.", "1. MCP gives the bot hands: real tools for Keycloak, GitLab, Kubernetes, PostgreSQL, and other services.")}</p>
                    <p>{tr("2. Скиллы задают корпоративный плейбук: discovery, preflight, pinned context, guardrails и правила отчётности.", "2. Skills give the bot the company playbook: discovery, preflight, pinned context, guardrails, and reporting rules.")}</p>
                    <p>{tr("3. Agent Config объединяет модель, инструменты, MCP и выбранные скиллы в переиспользуемого бота для администраторов.", "3. Agent Config combines model, tools, MCP servers, and selected skills into a reusable bot for admins.")}</p>
                  </div>
                </CardContent>
              </Card>

              {templates.length > 0 && (
                <div className="rounded-md border border-border bg-card/70 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <Label className="text-xs">{tr("Стартовые шаблоны", "Starter Templates")}</Label>
                      <p className="mt-1 text-[11px] text-muted-foreground">{tr("Используйте их для генерации скилла вместо ручного старта с Markdown.", "Use these to scaffold a skill pack instead of starting from raw Markdown.")}</p>
                    </div>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11px]" onClick={() => openCreateDialog()}>
                      <Sparkles className="h-3 w-3" />
                      {tr("Пустой мастер", "Blank Wizard")}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {templates.map((template) => (
                      <TemplateCard key={template.slug} template={template} onUse={() => openCreateDialog(template)} />
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-md border border-border bg-card/70 p-4">
                <div className="mb-3">
                  <Label className="text-xs">{tr("Просмотр скиллов", "Browse Skills")}</Label>
                  <p className="mt-1 text-[11px] text-muted-foreground">{tr("Фильтруйте по сервису и изучайте плейбук и runtime-политику справа.", "Filter by service, then inspect the playbook and runtime policy on the right.")}</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={tr("Поиск по скиллам, сервисам и тегам...", "Search skills, services, tags...")}
                      className="h-10 rounded-md pl-9 text-sm"
                    />
                  </div>
                  <Select value={serviceFilter} onValueChange={setServiceFilter}>
                    <SelectTrigger className="h-10 rounded-md text-xs">
                      <SelectValue placeholder={tr("Все сервисы", "All services")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{tr("Все сервисы", "All services")}</SelectItem>
                      {services.map((service) => (
                        <SelectItem key={service} value={service}>{service}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-4">
                  {isLoading ? (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {tr("Загрузка скиллов...", "Loading skills...")}
                    </div>
                  ) : filteredSkills.length === 0 ? (
                    <Card className="rounded-[22px] border-border bg-background/45">
                      <CardContent className="flex h-40 items-center justify-center text-center text-sm text-muted-foreground">
                        {tr("По текущим фильтрам скиллы не найдены.", "No skills match the current filters.")}
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {filteredSkills.map((skill) => (
                        <SkillCard
                          key={skill.slug}
                          skill={skill}
                          isSelected={skill.slug === selectedSlug}
                          onSelect={() => setSelectedSlug(skill.slug)}
                          lang={lang}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="min-w-0">
            {!selectedSlug ? (
              <Card className="rounded-md border-border bg-card/70">
                <CardContent className="flex h-72 items-center justify-center text-center text-sm text-muted-foreground">
                  {tr("Выберите скилл, чтобы изучить его плейбук и guardrails.", "Select a skill to inspect its playbook and guardrails.")}
                </CardContent>
              </Card>
            ) : isFetchingSkill && !selectedSkill ? (
              <Card className="rounded-md border-border bg-card/70">
                <CardContent className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tr("Загрузка деталей скилла...", "Loading skill details...")}
                </CardContent>
              </Card>
            ) : selectedSkill ? (
              <div className="space-y-4">
                <Card className="rounded-md border-border bg-card">
                  <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{selectedSkill.name}</CardTitle>
                      <Badge variant="outline" className="font-mono text-[10px]">{selectedSkill.slug}</Badge>
                      {selectedSkill.runtime_enforced && <Badge variant="secondary" className="text-[9px]">{tr("runtime enforced", "runtime enforced")}</Badge>}
                      {selectedSkill.safety_level && <Badge variant="outline" className="text-[9px]">{selectedSkill.safety_level}</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {selectedSkill.service && <span>{selectedSkill.service}</span>}
                      {selectedSkill.category && <span>· {selectedSkill.category}</span>}
                      <span>· {selectedSkill.path}</span>
                    </div>
                    {selectedSkill.description && <p className="text-sm text-muted-foreground">{selectedSkill.description}</p>}
                    {selectedSkill.ui_hint && <p className="text-xs text-muted-foreground">{selectedSkill.ui_hint}</p>}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedSkill.guardrail_summary?.length > 0 && (
                      <div className="rounded-md border border-border bg-muted/20 p-4">
                        <p className="text-xs font-medium">{tr("Guardrails", "Guardrails")}</p>
                        <div className="mt-2 space-y-1">
                          {selectedSkill.guardrail_summary.map((item) => (
                            <p key={item} className="text-[11px] text-muted-foreground">• {item}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedSkill.recommended_tools?.length > 0 && (
                      <div className="rounded-md border border-border bg-muted/20 p-4">
                        <p className="text-xs font-medium">{tr("Рекомендуемые инструменты агента", "Recommended agent tools")}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {selectedSkill.recommended_tools.map((toolName) => (
                            <Badge key={toolName} variant="secondary" className="text-[10px]">{toolName}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedSkill.runtime_enforced && (
                      <div className="rounded-md border border-border bg-muted/20 p-4">
                        <p className="text-xs font-medium">{tr("Runtime policy", "Runtime policy")}</p>
                        <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/60 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                          {JSON.stringify(selectedSkill.runtime_policy, null, 2)}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-md border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-base">{tr("Плейбук скилла", "Skill Playbook")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <SkillMarkdown content={selectedSkill.content} />
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card className="rounded-md border-border bg-card/70">
                <CardContent className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                  {tr("Детали скилла недоступны.", "Skill details are unavailable.")}
                </CardContent>
              </Card>
            )}
          </div>
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-auto rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{tr("Мастер скиллов", "Skill Wizard")}</DialogTitle>
            <DialogDescription>{tr("Создайте корпоративный пакет скиллов из шаблона сервиса или с нуля.", "Create a corporate skill pack from a service template or from scratch.")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4 rounded-md border border-border bg-card/70 p-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("Шаблон сервиса", "Service Template")}</Label>
                <Select
                  value={selectedTemplateSlug}
                  onValueChange={(value) => {
                    setSelectedTemplateSlug(value);
                    const template = templates.find((item) => item.slug === value) || null;
                    setWizard(createWizardState(template));
                    setSlugTouched(false);
                  }}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder={tr("Начать с нуля", "Start from scratch")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{tr("Пустой мастер", "Blank wizard")}</SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.slug} value={template.slug}>{template.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedTemplate && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium">{selectedTemplate.name}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{selectedTemplate.description}</p>
                    <p className="text-[10px] text-muted-foreground">{selectedTemplate.summary}</p>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("Название", "Name")}</Label>
                  <Input
                    value={wizard.name}
                    onChange={(e) => {
                      const value = e.target.value;
                      setWizard((prev) => ({
                        ...prev,
                        name: value,
                        slug: slugTouched ? prev.slug : slugifySkillName(value),
                      }));
                    }}
                    placeholder={tr("Рабочий процесс операций Keycloak", "Keycloak Operations Workflow")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("Slug", "Slug")}</Label>
                  <Input
                    value={wizard.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setWizard((prev) => ({ ...prev, slug: e.target.value }));
                    }}
                    placeholder={tr("keycloak-operations-workflow", "keycloak-operations-workflow")}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{tr("Описание", "Description")}</Label>
                <Textarea
                  rows={3}
                  value={wizard.description}
                  onChange={(e) => setWizard((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder={tr("Когда этот скилл нужно подключать и использовать.", "When this skill should be attached and used.")}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("Сервис", "Service")}</Label>
                  <Input value={wizard.service} onChange={(e) => setWizard((prev) => ({ ...prev, service: e.target.value }))} placeholder={tr("keycloak", "keycloak")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("Категория", "Category")}</Label>
                  <Input value={wizard.category} onChange={(e) => setWizard((prev) => ({ ...prev, category: e.target.value }))} placeholder={tr("Управление доступом", "Identity and Access")} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("Уровень безопасности", "Safety level")}</Label>
                  <Select value={wizard.safety_level} onValueChange={(value) => setWizard((prev) => ({ ...prev, safety_level: value }))}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SAFETY_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>{level}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("UI-подсказка", "UI hint")}</Label>
                  <Input value={wizard.ui_hint} onChange={(e) => setWizard((prev) => ({ ...prev, ui_hint: e.target.value }))} placeholder={tr("Подсказка для админа в интерфейсе Studio", "Admin-facing instruction shown in Studio")} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{tr("Теги", "Tags")}</Label>
                <Input value={wizard.tags_text} onChange={(e) => setWizard((prev) => ({ ...prev, tags_text: e.target.value }))} placeholder={tr("keycloak, iam, mcp, безопасность", "keycloak, iam, mcp, safety")} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{tr("Сводка guardrail-правил", "Guardrail summary")}</Label>
                <Textarea
                  rows={2}
                  value={wizard.guardrail_summary_text}
                  onChange={(e) => setWizard((prev) => ({ ...prev, guardrail_summary_text: e.target.value }))}
                  placeholder={tr("Требует preflight, фиксирует profile=test, блокирует переключение профиля", "Requires preflight, Pins profile=test, Blocks profile switching")}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{tr("Рекомендуемые инструменты агента", "Recommended agent tools")}</Label>
                <Input value={wizard.recommended_tools_text} onChange={(e) => setWizard((prev) => ({ ...prev, recommended_tools_text: e.target.value }))} placeholder={tr("report, ask_user, analyze_output", "report, ask_user, analyze_output")} />
              </div>
            </div>

            <div className="space-y-4 rounded-md border border-border bg-card/70 p-4">
              <div className="rounded-[22px] border border-border bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">{tr("Runtime policy", "Runtime policy")}</p>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {tr("Оставляйте шаблонную policy по умолчанию, если не уверены в точных названиях MCP-инструментов и закреплённых аргументах.", "Keep the template default unless you know the exact original MCP tool names and pinned arguments.")}
                </p>
                <Textarea
                  rows={16}
                  value={wizard.runtime_policy_text}
                  onChange={(e) => setWizard((prev) => ({ ...prev, runtime_policy_text: e.target.value }))}
                  className="mt-3 font-mono text-[11px]"
                />
              </div>

              <div className="rounded-[22px] border border-border bg-muted/20 p-4 space-y-3">
                <p className="text-sm font-medium">{tr("Необязательные папки скилла", "Optional skill folders")}</p>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">{tr("references/", "references/")}</p>
                    <p className="text-[10px] text-muted-foreground">{tr("Доменные документы, примеры и длинные процедуры.", "Domain docs, examples, and longer procedures.")}</p>
                  </div>
                  <Switch checked={wizard.with_references} onCheckedChange={(checked) => setWizard((prev) => ({ ...prev, with_references: Boolean(checked) }))} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">{tr("scripts/", "scripts/")}</p>
                    <p className="text-[10px] text-muted-foreground">{tr("Детерминированные помощники для хрупких и повторяющихся действий.", "Deterministic helpers for fragile or repetitive actions.")}</p>
                  </div>
                  <Switch checked={wizard.with_scripts} onCheckedChange={(checked) => setWizard((prev) => ({ ...prev, with_scripts: Boolean(checked) }))} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">{tr("assets/", "assets/")}</p>
                    <p className="text-[10px] text-muted-foreground">{tr("Шаблоны, бренд-файлы и выходные ассеты.", "Templates, brand files, and output assets.")}</p>
                  </div>
                  <Switch checked={wizard.with_assets} onCheckedChange={(checked) => setWizard((prev) => ({ ...prev, with_assets: Boolean(checked) }))} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">{tr("Перезаписать существующий скилл", "Overwrite existing skill")}</p>
                    <p className="text-[10px] text-muted-foreground">{tr("Используйте только если осознанно обновляете тот же slug.", "Use only when intentionally updating the same slug.")}</p>
                  </div>
                  <Switch checked={wizard.force} onCheckedChange={(checked) => setWizard((prev) => ({ ...prev, force: Boolean(checked) }))} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tr("Отмена", "Cancel")}</Button>
            <Button onClick={submitWizard} disabled={!wizard.name.trim() || !wizard.description.trim() || scaffoldMutation.isPending} className="gap-1.5">
              {scaffoldMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
              {tr("Создать скилл", "Create Skill")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={validateOpen} onOpenChange={setValidateOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-auto rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{tr("Валидация библиотеки скиллов", "Skill Library Validation")}</DialogTitle>
            <DialogDescription>{tr("Проверьте структурные и policy-проблемы в текущей библиотеке скиллов Studio.", "Review structural and policy issues across the current Studio skill library.")}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 rounded-[22px] border border-border bg-muted/20 p-4">
            <div>
              <p className="text-sm font-medium">{tr("Режим валидации", "Validation mode")}</p>
              <p className="text-[11px] text-muted-foreground">{tr("В строгом режиме предупреждения считаются блокерами деплоя.", "Strict mode treats warnings as deployment blockers.")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">{tr("Строгий", "Strict")}</Label>
              <Switch checked={strictValidation} onCheckedChange={(checked) => setStrictValidation(Boolean(checked))} />
              <Button variant="outline" size="sm" onClick={() => validateMutation.mutate()} className="gap-1.5">
                {validateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
                {tr("Повторить", "Re-run")}
              </Button>
            </div>
          </div>

          {validationReport ? (
            <div className="space-y-3">
              <ValidationSummaryCard report={validationReport} />
              {validationReport.results.map((result) => (
                <Card key={result.slug} className={result.errors.length ? "border-red-500/30" : result.warnings.length ? "border-amber-500/30" : "border-green-500/20"}>
                  <CardHeader className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-sm">{result.slug}</CardTitle>
                      {result.errors.length === 0 && result.warnings.length === 0 && <Badge variant="secondary" className="text-[10px]">ok</Badge>}
                      {result.errors.length > 0 && <Badge variant="destructive" className="text-[10px]">{result.errors.length} {tr("ошибок", "errors")}</Badge>}
                      {result.warnings.length > 0 && <Badge variant="outline" className="text-[10px]">{result.warnings.length} {tr("предупреждений", "warnings")}</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{result.path}</p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {result.errors.length > 0 && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                        <p className="text-xs font-medium text-red-200">{tr("Ошибки", "Errors")}</p>
                        <div className="mt-1 space-y-1">
                          {result.errors.map((item) => (
                            <p key={item} className="text-[11px] text-red-100">• {item}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {result.warnings.length > 0 && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <p className="text-xs font-medium text-amber-100">{tr("Предупреждения", "Warnings")}</p>
                        <div className="mt-1 space-y-1">
                          {result.warnings.map((item) => (
                            <p key={item} className="text-[11px] text-amber-50">• {item}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {tr("Валидация ещё не запускалась.", "Validation has not been run yet.")}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

