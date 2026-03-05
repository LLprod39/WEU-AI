import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Globe2, Loader2, ShieldCheck, Sparkles, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authLogin, fetchAuthSession } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";

export default function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, lang, setLang } = useI18n();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const nextFromUrl = searchParams.get("next") || "";

  const { data: session } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: fetchAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (session?.authenticated) {
      navigate(nextFromUrl || "/servers", { replace: true });
    }
  }, [session?.authenticated, navigate, nextFromUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await authLogin(username, password);
      await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
      const nextUrl = nextFromUrl || result.next_url || "/servers";
      navigate(nextUrl, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_440px]">
        <section className="enterprise-panel hidden rounded-2xl px-8 py-8 lg:block">
          <div className="enterprise-kicker">Platform Access</div>
          <div className="mt-4 max-w-xl space-y-4">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Secure access to the operations workspace
            </h1>
            <p className="text-sm leading-7 text-muted-foreground">
              Sign in to manage infrastructure, agent workflows, access policies and pipeline automation
              from a single control plane designed for internal platform teams.
            </p>
          </div>

          <div className="mt-8 grid gap-3">
            <div className="enterprise-stat rounded-2xl px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Protected operator access</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Use centralized authentication before touching servers, pipelines or access rules.</p>
                </div>
              </div>
            </div>
            <div className="enterprise-stat rounded-2xl px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                  <Sparkles className="h-5 w-5 text-violet-300" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Unified AI operations</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Run agents, inspect terminals and approve workflows from the same enterprise shell.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="w-full">
          <div className="enterprise-panel w-full rounded-2xl px-6 py-6 sm:px-7 sm:py-7">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
                  <Terminal className="h-6 w-6 text-primary" />
                </div>
                <h1 className="text-2xl font-semibold text-foreground">
                  {t("login.title")}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>
              </div>
              <div className="inline-flex rounded-2xl border border-border overflow-hidden text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setLang("en")}
                  className={`px-3 py-2 transition-colors ${lang === "en" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setLang("ru")}
                  className={`px-3 py-2 transition-colors ${lang === "ru" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  RU
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm text-foreground">{t("login.username")}</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="bg-background/70"
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm text-foreground">{t("login.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background/70"
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full gap-2" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {t("login.submit")}
              </Button>
            </form>

            <div className="mt-6 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {t("login.footer")}
              </p>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
                <Globe2 className="h-3.5 w-3.5" />
                Corporate platform sign-in
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

