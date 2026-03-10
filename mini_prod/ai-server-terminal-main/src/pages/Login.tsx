import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Terminal, Loader2 } from "lucide-react";
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
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
            <Terminal className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">{t("login.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm text-foreground">
              {t("login.username")}
            </Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="border-border bg-secondary focus:border-primary"
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm text-foreground">
              {t("login.password")}
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-border bg-secondary focus:border-primary"
              autoComplete="current-password"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("login.submit")}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground">{t("login.footer")}</p>
          <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`px-2 py-0.5 transition-colors ${lang === "en" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang("ru")}
              className={`px-2 py-0.5 transition-colors ${lang === "ru" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              RU
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
