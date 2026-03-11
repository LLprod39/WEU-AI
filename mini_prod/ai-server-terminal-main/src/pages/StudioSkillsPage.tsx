import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, ArrowLeft, BookOpen, Bot, CheckCircle2, Code2, FileCode2, FileText, FolderOpen, Loader2, Plus, Save, Search, Server, Shield, Sparkles, Trash2, WandSparkles } from "lucide-react";
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
  type StudioSkillWorkspaceFile,
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

type WorkspaceDraftKind = "reference" | "script" | "asset";

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

function defaultWorkspaceFilename(kind: WorkspaceDraftKind) {
  if (kind === "reference") return "example.md";
  if (kind === "script") return "helper.sh";
  return "notes.txt";
}

function buildWorkspacePath(kind: WorkspaceDraftKind, filename: string) {
  const trimmed = filename.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed) return "";
  if (kind === "reference") {
    return `references/${trimmed.includes(".") ? trimmed : `${trimmed}.md`}`;
  }
  if (kind === "script") {
    return `scripts/${trimmed.includes(".") ? trimmed : `${trimmed}.sh`}`;
  }
  return `assets/${trimmed.includes(".") ? trimmed : `${trimmed}.txt`}`;
}

function buildWorkspaceTemplate(kind: WorkspaceDraftKind, filename: string, skillName: string) {
  const stem = filename.replace(/\.[^.]+$/, "") || "new-file";
  if (kind === "reference") {
    return `# ${stem}\n\nContext for ${skillName}.\n\n## Examples\n\n- Example request\n- Example expected result\n`;
  }
  if (kind === "script") {
    return `#!/usr/bin/env bash\nset -euo pipefail\n\n# ${skillName}: ${stem}\n# Add deterministic helper logic here.\n`;
  }
  return `# ${skillName}: ${stem}\n\nAdd supporting text, snippets, or templates here.\n`;
}

const WORKSPACE_UPLOAD_ACCEPT = [
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".csv",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".js",
  ".ts",
].join(",");

function workspaceFileIcon(kind: StudioSkillWorkspaceFile["kind"]) {
  if (kind === "skill" || kind === "reference") return FileText;
  if (kind === "script") return FileCode2;
  return Code2;
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
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("SKILL.md");
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);
  const [workspaceCreateKind, setWorkspaceCreateKind] = useState<WorkspaceDraftKind>("reference");
  const [workspaceCreateName, setWorkspaceCreateName] = useState(defaultWorkspaceFilename("reference"));
  const [workspaceUploadOpen, setWorkspaceUploadOpen] = useState(false);
  const [workspaceUploadKind, setWorkspaceUploadKind] = useState<WorkspaceDraftKind>("reference");
  const [workspaceUploadName, setWorkspaceUploadName] = useState("");
  const [workspaceUploadFile, setWorkspaceUploadFile] = useState<File | null>(null);
  const workspaceUploadInputRef = useRef<HTMLInputElement | null>(null);

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

  const { data: workspace, isFetching: isFetchingWorkspace } = useQuery({
    queryKey: ["studio", "skills", selectedSlug, "workspace"],
    queryFn: () => studioSkills.workspace(selectedSlug),
    enabled: workspaceOpen && !!selectedSlug,
  });

  const { data: activeWorkspaceFile, isFetching: isFetchingWorkspaceFile } = useQuery({
    queryKey: ["studio", "skills", selectedSlug, "workspace-file", workspacePath],
    queryFn: () => studioSkills.readFile(selectedSlug, workspacePath),
    enabled: workspaceOpen && !!selectedSlug && !!workspacePath,
  });

  const openCreateDialog = (template?: StudioSkillTemplate | null) => {
    setSelectedTemplateSlug(template?.slug || "__none__");
    setWizard(createWizardState(template || null));
    setSlugTouched(false);
    setCreateOpen(true);
  };

  useEffect(() => {
    if (!workspaceOpen) return;
    setWorkspaceStatus(null);
  }, [workspaceOpen, workspacePath]);

  useEffect(() => {
    if (!workspaceOpen || !workspace?.files?.length) return;
    const hasCurrent = workspace.files.some((file) => file.path === workspacePath);
    if (hasCurrent) return;
    const nextPath = workspace.files.some((file) => file.path === "SKILL.md") ? "SKILL.md" : workspace.files[0].path;
    setWorkspacePath(nextPath);
  }, [workspace, workspaceOpen, workspacePath]);

  useEffect(() => {
    if (!activeWorkspaceFile) return;
    setWorkspaceDraft(activeWorkspaceFile.content);
    setWorkspaceDirty(false);
  }, [activeWorkspaceFile?.path, activeWorkspaceFile?.content]);

  const workspaceFilesByKind = useMemo(() => {
    const groups: Record<string, StudioSkillWorkspaceFile[]> = {
      skill: [],
      reference: [],
      script: [],
      asset: [],
      file: [],
    };
    for (const file of workspace?.files || []) {
      groups[file.kind] = [...(groups[file.kind] || []), file];
    }
    return groups;
  }, [workspace?.files]);

  const selectedWorkspaceMeta = useMemo(
    () => workspace?.files.find((file) => file.path === workspacePath) || null,
    [workspace?.files, workspacePath],
  );

  const workspaceExistingPaths = useMemo(() => new Set((workspace?.files || []).map((file) => file.path)), [workspace?.files]);

  const refreshWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ["studio", "skills", selectedSlug, "workspace"] });
    queryClient.invalidateQueries({ queryKey: ["studio", "skills", selectedSlug] });
    queryClient.invalidateQueries({ queryKey: ["studio", "skills"] });
  };

  const selectWorkspaceFile = (nextPath: string) => {
    if (nextPath === workspacePath) return;
    if (workspaceDirty && !window.confirm(tr("Есть несохранённые изменения. Переключить файл и потерять draft?", "You have unsaved changes. Switch files and discard the draft?"))) {
      return;
    }
    setWorkspacePath(nextPath);
    setWorkspaceStatus(null);
  };

  const resetWorkspaceUpload = (kind: WorkspaceDraftKind = "reference") => {
    setWorkspaceUploadKind(kind);
    setWorkspaceUploadName("");
    setWorkspaceUploadFile(null);
    if (workspaceUploadInputRef.current) {
      workspaceUploadInputRef.current.value = "";
    }
  };

  const saveWorkspaceFileMutation = useMutation({
    mutationFn: (payload: { path: string; content: string }) => studioSkills.updateFile(selectedSlug, payload),
    onSuccess: (response) => {
      refreshWorkspace();
      queryClient.invalidateQueries({ queryKey: ["studio", "skills", selectedSlug, "workspace-file", workspacePath] });
      setWorkspaceDirty(false);
      setWorkspaceStatus(
        response.validation.errors.length
          ? tr("Файл сохранён, но skill не проходит валидацию.", "File saved, but the skill currently fails validation.")
          : response.validation.warnings.length
            ? tr("Файл сохранён с предупреждениями валидации.", "File saved with validation warnings.")
            : tr("Файл сохранён.", "File saved."),
      );
      toast({
        description:
          response.validation.errors.length
            ? tr("Сохранено, но в skill есть ошибки валидации.", "Saved, but the skill has validation errors.")
            : tr("Изменения сохранены", "Changes saved"),
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", description: error.message });
    },
  });

  const createWorkspaceFileMutation = useMutation({
    mutationFn: (payload: { path: string; content: string }) => studioSkills.createFile(selectedSlug, payload),
    onSuccess: (response) => {
      refreshWorkspace();
      setWorkspaceCreateOpen(false);
      setWorkspacePath(response.file?.path || workspacePath);
      setWorkspaceStatus(tr("Файл создан.", "File created."));
      if (response.file?.path) {
        queryClient.invalidateQueries({ queryKey: ["studio", "skills", selectedSlug, "workspace-file", response.file.path] });
      }
      toast({ description: tr("Файл skill pack создан", "Skill pack file created") });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", description: error.message });
    },
  });

  const deleteWorkspaceFileMutation = useMutation({
    mutationFn: (path: string) => studioSkills.deleteFile(selectedSlug, path),
    onSuccess: () => {
      const nextPath = workspace?.files.find((file) => file.path !== workspacePath)?.path || "SKILL.md";
      refreshWorkspace();
      queryClient.removeQueries({ queryKey: ["studio", "skills", selectedSlug, "workspace-file", workspacePath] });
      setWorkspacePath(nextPath);
      setWorkspaceStatus(tr("Файл удалён.", "File deleted."));
      toast({ description: tr("Файл удалён", "File deleted") });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", description: error.message });
    },
  });

  const uploadWorkspaceFileMutation = useMutation({
    mutationFn: async (payload: { kind: WorkspaceDraftKind; name: string; file: File }) => {
      const path = buildWorkspacePath(payload.kind, payload.name || payload.file.name);
      if (!path) {
        throw new Error(tr("Укажите имя файла.", "Enter a file name."));
      }
      const content = await payload.file.text();
      if (workspaceExistingPaths.has(path)) {
        return {
          path,
          response: await studioSkills.updateFile(selectedSlug, { path, content }),
          replaced: true,
        };
      }
      return {
        path,
        response: await studioSkills.createFile(selectedSlug, { path, content }),
        replaced: false,
      };
    },
    onSuccess: ({ path, response, replaced }) => {
      refreshWorkspace();
      setWorkspaceUploadOpen(false);
      resetWorkspaceUpload(workspaceUploadKind);
      setWorkspaceOpen(true);
      selectWorkspaceFile(path);
      queryClient.invalidateQueries({ queryKey: ["studio", "skills", selectedSlug, "workspace-file", path] });
      setWorkspaceStatus(
        response.validation.errors.length
          ? tr("Файл загружен, но skill не проходит валидацию.", "File uploaded, but the skill currently fails validation.")
          : response.validation.warnings.length
            ? tr("Файл загружен с предупреждениями валидации.", "File uploaded with validation warnings.")
            : replaced
              ? tr("Файл обновлён.", "File updated.")
              : tr("Файл загружен.", "File uploaded."),
      );
      toast({
        description: replaced
          ? tr("Файл в skill pack обновлён", "Skill pack file updated")
          : tr("Файл добавлен в skill pack", "File added to the skill pack"),
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", description: error.message });
    },
  });

  const openWorkspace = (path?: string) => {
    setWorkspaceOpen(true);
    setWorkspaceStatus(null);
    setWorkspacePath(path || "SKILL.md");
  };

  const openWorkspaceCreate = (kind: WorkspaceDraftKind = "reference") => {
    setWorkspaceOpen(true);
    setWorkspaceCreateKind(kind);
    setWorkspaceCreateName(defaultWorkspaceFilename(kind));
    setWorkspaceCreateOpen(true);
  };

  const openWorkspaceUpload = (kind: WorkspaceDraftKind = "reference") => {
    setWorkspaceOpen(true);
    resetWorkspaceUpload(kind);
    setWorkspaceUploadOpen(true);
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
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-md" onClick={() => navigate("/studio")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="enterprise-kicker">{tr("Корпоративная библиотека скиллов", "Corporate Skill Library")}</span>
            </div>
            <div className="space-y-2">
              <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-foreground md:text-[2rem]">
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10">
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
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span>{tr(`${skills.length} скиллов`, `${skills.length} skills`)}</span>
                <span>{tr(`${runtimeEnforcedCount} c enforced runtime`, `${runtimeEnforcedCount} runtime-enforced`)}</span>
                <span>{tr(`${serviceCount} сервисных доменов`, `${serviceCount} service domains`)}</span>
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

      <div className="flex-1 overflow-auto px-6 pb-8">
        <div className="space-y-4">
          {validationReport && <ValidationSummaryCard report={validationReport} />}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
            <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              <Card className="overflow-hidden rounded-md border-0 bg-primary/5 shadow-none">
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
                <div className="rounded-md bg-card/70 p-4">
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

              <div className="rounded-md bg-card/70 p-4">
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
                    <Card className="rounded-[22px] border-0 bg-background/45 shadow-none">
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
              <Card className="rounded-md border-0 bg-card/70 shadow-none">
                <CardContent className="flex h-72 items-center justify-center text-center text-sm text-muted-foreground">
                  {tr("Выберите скилл, чтобы изучить его плейбук и guardrails.", "Select a skill to inspect its playbook and guardrails.")}
                </CardContent>
              </Card>
            ) : isFetchingSkill && !selectedSkill ? (
              <Card className="rounded-md border-0 bg-card/70 shadow-none">
                <CardContent className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tr("Загрузка деталей скилла...", "Loading skill details...")}
                </CardContent>
              </Card>
            ) : selectedSkill ? (
              <div className="space-y-4">
                <Card className="rounded-md border-0 bg-card shadow-none">
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
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11px]" onClick={() => openWorkspace("SKILL.md")}>
                        <FolderOpen className="h-3.5 w-3.5" />
                        {tr("Открыть workspace", "Open workspace")}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11px]" onClick={() => openWorkspaceCreate()}>
                        <Plus className="h-3.5 w-3.5" />
                        {tr("Новый файл", "New file")}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11px]" onClick={() => openWorkspaceUpload()}>
                        <ArrowLeft className="h-3.5 w-3.5 rotate-90" />
                        {tr("Загрузить файл", "Upload file")}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedSkill.guardrail_summary?.length > 0 && (
                      <div className="rounded-md bg-muted/20 p-4">
                        <p className="text-xs font-medium">{tr("Guardrails", "Guardrails")}</p>
                        <div className="mt-2 space-y-1">
                          {selectedSkill.guardrail_summary.map((item) => (
                            <p key={item} className="text-[11px] text-muted-foreground">• {item}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedSkill.recommended_tools?.length > 0 && (
                      <div className="rounded-md bg-muted/20 p-4">
                        <p className="text-xs font-medium">{tr("Рекомендуемые инструменты агента", "Recommended agent tools")}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {selectedSkill.recommended_tools.map((toolName) => (
                            <Badge key={toolName} variant="secondary" className="text-[10px]">{toolName}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedSkill.runtime_enforced && (
                      <div className="rounded-md bg-muted/20 p-4">
                        <p className="text-xs font-medium">{tr("Runtime policy", "Runtime policy")}</p>
                        <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                          {JSON.stringify(selectedSkill.runtime_policy, null, 2)}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-md border-0 bg-card shadow-none">
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
              <Card className="rounded-md border-0 bg-card/70 shadow-none">
                <CardContent className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                  {tr("Детали скилла недоступны.", "Skill details are unavailable.")}
                </CardContent>
              </Card>
            )}
          </div>
          </div>
      </div>
      </div>

      <Dialog
        open={workspaceOpen}
        onOpenChange={(open) => {
          if (!open && workspaceDirty && !window.confirm(tr("Есть несохранённые изменения. Закрыть editor и потерять draft?", "You have unsaved changes. Close the editor and discard the draft?"))) {
            return;
          }
          setWorkspaceOpen(open);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden rounded-md border-border bg-background p-0">
          <div className="flex h-[82vh] min-h-[620px] flex-col">
            <DialogHeader className="border-b border-border px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <DialogTitle>{tr("Skill Workspace", "Skill Workspace")}</DialogTitle>
                  <DialogDescription>
                    {tr(
                      "Редактируйте SKILL.md, примеры в references/, детерминированные helper scripts и текстовые assets прямо из веба.",
                      "Edit SKILL.md, examples in references/, deterministic helper scripts, and text assets directly from the web.",
                    )}
                  </DialogDescription>
                </div>
                {workspace?.validation ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {workspace.validation.errors.length > 0 ? (
                      <Badge variant="destructive" className="text-[10px]">{workspace.validation.errors.length} {tr("ошибок", "errors")}</Badge>
                    ) : null}
                    {workspace.validation.warnings.length > 0 ? (
                      <Badge variant="outline" className="text-[10px]">{workspace.validation.warnings.length} {tr("предупреждений", "warnings")}</Badge>
                    ) : null}
                    {workspace.validation.errors.length === 0 && workspace.validation.warnings.length === 0 ? (
                      <Badge variant="secondary" className="text-[10px]">{tr("валидно", "valid")}</Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </DialogHeader>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[290px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
                <div className="mb-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11px]" onClick={() => openWorkspaceCreate()}>
                    <Plus className="h-3 w-3" />
                    {tr("Новый", "New")}
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11px]" onClick={() => openWorkspaceUpload()}>
                    <ArrowLeft className="h-3 w-3 rotate-90" />
                    {tr("Загрузить", "Upload")}
                  </Button>
                </div>

                {isFetchingWorkspace && !workspace ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {tr("Загрузка workspace...", "Loading workspace...")}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {([
                      ["skill", tr("Основной skill", "Main skill")],
                      ["reference", tr("References", "References")],
                      ["script", tr("Scripts", "Scripts")],
                      ["asset", tr("Assets", "Assets")],
                    ] as Array<[StudioSkillWorkspaceFile["kind"], string]>).map(([kind, label]) => {
                      const files = workspaceFilesByKind[kind] || [];
                      if (!files.length) return null;
                      return (
                        <div key={kind} className="space-y-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                          {files.map((file) => {
                            const Icon = workspaceFileIcon(file.kind);
                            return (
                              <button
                                key={file.path}
                                type="button"
                                onClick={() => selectWorkspaceFile(file.path)}
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${
                                  file.path === workspacePath ? "bg-primary/10 text-foreground" : "hover:bg-muted/30 text-muted-foreground"
                                }`}
                              >
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium text-foreground">{file.name}</div>
                                  <div className="truncate text-[10px] text-muted-foreground">{file.path}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                    {workspace?.files?.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                        {tr("Workspace пока пустой.", "The workspace is empty.")}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="min-h-0 flex flex-col">
                <div className="border-b border-border px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{selectedWorkspaceMeta?.path || "SKILL.md"}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {selectedWorkspaceMeta ? (
                          <>
                            <span>{selectedWorkspaceMeta.kind}</span>
                            <span>·</span>
                            <span>{selectedWorkspaceMeta.language}</span>
                            <span>·</span>
                            <span>{selectedWorkspaceMeta.size}b</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 rounded-md px-3 text-[11px]"
                        onClick={() => saveWorkspaceFileMutation.mutate({ path: workspacePath, content: workspaceDraft })}
                        disabled={!selectedWorkspaceMeta || !workspaceDirty || saveWorkspaceFileMutation.isPending}
                      >
                        {saveWorkspaceFileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        {tr("Сохранить", "Save")}
                      </Button>
                      {selectedWorkspaceMeta && selectedWorkspaceMeta.path !== "SKILL.md" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 rounded-md px-3 text-[11px] text-destructive hover:text-destructive"
                          onClick={() => {
                            if (!window.confirm(tr("Удалить этот файл из skill pack?", "Delete this file from the skill pack?"))) return;
                            deleteWorkspaceFileMutation.mutate(selectedWorkspaceMeta.path);
                          }}
                          disabled={deleteWorkspaceFileMutation.isPending}
                        >
                          {deleteWorkspaceFileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          {tr("Удалить", "Delete")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1">
                  {isFetchingWorkspaceFile && !activeWorkspaceFile ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {tr("Загрузка файла...", "Loading file...")}
                    </div>
                  ) : selectedWorkspaceMeta ? (
                    <div className="flex h-full flex-col">
                      <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
                        {selectedWorkspaceMeta.path === "SKILL.md"
                          ? tr("Главный playbook skill pack. Здесь держи основную инструкцию, workflow и guardrails.", "Main skill pack playbook. Keep the core instruction set, workflow, and guardrails here.")
                          : selectedWorkspaceMeta.kind === "reference"
                            ? tr("Reference-файлы подходят для длинной документации, runbooks и примеров.", "Reference files are good for longer docs, runbooks, and examples.")
                            : selectedWorkspaceMeta.kind === "script"
                              ? tr("Scripts — для детерминированных helper-ов, которые агент может вызывать как часть skill pack workflow.", "Scripts are for deterministic helpers that can support the skill pack workflow.")
                              : tr("Текстовый asset внутри skill pack.", "Text asset inside the skill pack.")}
                      </div>
                      <div className="min-h-0 flex-1 p-4">
                        <Textarea
                          value={workspaceDraft}
                          onChange={(event) => {
                            setWorkspaceDraft(event.target.value);
                            setWorkspaceDirty(true);
                            setWorkspaceStatus(null);
                          }}
                          className="h-full min-h-[420px] resize-none rounded-md border-border bg-background font-mono text-[12px] leading-6"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      {tr("Выберите файл слева.", "Select a file from the left.")}
                    </div>
                  )}
                </div>

                <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                  {workspaceStatus || (workspaceDirty ? tr("Есть несохранённые изменения.", "You have unsaved changes.") : tr("Изменений нет.", "No unsaved changes."))}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={workspaceCreateOpen} onOpenChange={setWorkspaceCreateOpen}>
        <DialogContent className="max-w-lg rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{tr("Новый файл skill pack", "New skill pack file")}</DialogTitle>
            <DialogDescription>
              {tr("Создайте reference, script или text asset прямо в веб-интерфейсе.", "Create a reference, script, or text asset directly from the web UI.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{tr("Тип файла", "File type")}</Label>
              <Select
                value={workspaceCreateKind}
                onValueChange={(value: WorkspaceDraftKind) => {
                  setWorkspaceCreateKind(value);
                  setWorkspaceCreateName(defaultWorkspaceFilename(value));
                }}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference">{tr("Reference document", "Reference document")}</SelectItem>
                  <SelectItem value="script">{tr("Helper script", "Helper script")}</SelectItem>
                  <SelectItem value="asset">{tr("Text asset", "Text asset")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{tr("Имя файла", "File name")}</Label>
              <Input
                value={workspaceCreateName}
                onChange={(event) => setWorkspaceCreateName(event.target.value)}
                placeholder={defaultWorkspaceFilename(workspaceCreateKind)}
              />
              <p className="text-[11px] text-muted-foreground">
                {buildWorkspacePath(workspaceCreateKind, workspaceCreateName || defaultWorkspaceFilename(workspaceCreateKind))}
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setWorkspaceCreateOpen(false)}>
              {tr("Отмена", "Cancel")}
            </Button>
            <Button
              onClick={() => {
                const path = buildWorkspacePath(workspaceCreateKind, workspaceCreateName);
                if (!path) {
                  toast({ variant: "destructive", description: tr("Укажите имя файла.", "Enter a file name.") });
                  return;
                }
                createWorkspaceFileMutation.mutate({
                  path,
                  content: buildWorkspaceTemplate(workspaceCreateKind, workspaceCreateName, selectedSkill?.name || selectedSlug || "Skill"),
                });
              }}
              disabled={createWorkspaceFileMutation.isPending}
              className="gap-1.5"
            >
              {createWorkspaceFileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {tr("Создать файл", "Create file")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={workspaceUploadOpen}
        onOpenChange={(open) => {
          setWorkspaceUploadOpen(open);
          if (!open) resetWorkspaceUpload(workspaceUploadKind);
        }}
      >
        <DialogContent className="max-w-lg rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{tr("Загрузить файл в skill pack", "Upload file into the skill pack")}</DialogTitle>
            <DialogDescription>
              {tr(
                "Загрузите локальный markdown, JSON, shell/python script или текстовый asset. Файл попадёт прямо в references/, scripts/ или assets/.",
                "Upload local markdown, JSON, shell/python scripts, or text assets. The file will go straight into references/, scripts/, or assets/.",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{tr("Тип файла", "File type")}</Label>
              <Select value={workspaceUploadKind} onValueChange={(value: WorkspaceDraftKind) => setWorkspaceUploadKind(value)}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference">{tr("Reference document", "Reference document")}</SelectItem>
                  <SelectItem value="script">{tr("Helper script", "Helper script")}</SelectItem>
                  <SelectItem value="asset">{tr("Text asset", "Text asset")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{tr("Локальный файл", "Local file")}</Label>
              <input
                ref={workspaceUploadInputRef}
                type="file"
                accept={WORKSPACE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] || null;
                  setWorkspaceUploadFile(nextFile);
                  setWorkspaceUploadName(nextFile?.name || "");
                }}
              />
              <Button type="button" variant="outline" className="w-full justify-between text-xs" onClick={() => workspaceUploadInputRef.current?.click()}>
                <span className="truncate">
                  {workspaceUploadFile?.name || tr("Выбрать файл", "Choose file")}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {workspaceUploadFile ? `${Math.max(1, Math.round(workspaceUploadFile.size / 1024))} KB` : tr("UTF-8 text only", "UTF-8 text only")}
                </span>
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{tr("Имя внутри skill pack", "Name inside the skill pack")}</Label>
              <Input
                value={workspaceUploadName}
                onChange={(event) => setWorkspaceUploadName(event.target.value)}
                placeholder={workspaceUploadFile?.name || defaultWorkspaceFilename(workspaceUploadKind)}
              />
              <p className="text-[11px] text-muted-foreground">
                {buildWorkspacePath(workspaceUploadKind, workspaceUploadName || workspaceUploadFile?.name || defaultWorkspaceFilename(workspaceUploadKind))}
              </p>
            </div>

            {workspaceUploadFile && workspaceExistingPaths.has(buildWorkspacePath(workspaceUploadKind, workspaceUploadName || workspaceUploadFile.name)) ? (
              <div className="rounded-md bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                {tr("Файл с таким путём уже существует и будет заменён.", "A file at this path already exists and will be replaced.")}
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setWorkspaceUploadOpen(false)}>
              {tr("Отмена", "Cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!workspaceUploadFile) {
                  toast({ variant: "destructive", description: tr("Сначала выберите локальный файл.", "Choose a local file first.") });
                  return;
                }
                const nextPath = buildWorkspacePath(workspaceUploadKind, workspaceUploadName || workspaceUploadFile.name);
                if (!nextPath) {
                  toast({ variant: "destructive", description: tr("Укажите имя файла.", "Enter a file name.") });
                  return;
                }
                uploadWorkspaceFileMutation.mutate({
                  kind: workspaceUploadKind,
                  name: workspaceUploadName || workspaceUploadFile.name,
                  file: workspaceUploadFile,
                });
              }}
              disabled={uploadWorkspaceFileMutation.isPending}
              className="gap-1.5"
            >
              {uploadWorkspaceFileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5 rotate-90" />}
              {tr("Загрузить", "Upload")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
