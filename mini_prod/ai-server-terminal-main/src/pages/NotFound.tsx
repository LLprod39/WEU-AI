import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { ArrowLeft, Compass, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();
  const { t } = useI18n();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="enterprise-panel w-full max-w-3xl rounded-2xl px-6 py-8 text-center sm:px-10 sm:py-10">
        <div className="enterprise-kicker">Routing</div>
        <div className="mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-[20px] bg-primary/10">
          <MapPinned className="h-8 w-8 text-primary" />
        </div>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground">{t("not_found.title")}</h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-muted-foreground">{t("not_found.text")}</p>
        <div className="mx-auto mt-6 max-w-lg rounded-2xl border border-border/70 bg-background/35 px-4 py-4 text-left">
          <div className="flex items-center gap-3">
            <Compass className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Requested path</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{location.pathname}</p>
            </div>
          </div>
        </div>
        <div className="mt-8 flex justify-center">
          <Button asChild className="gap-2">
            <a href="/">
              <ArrowLeft className="h-4 w-4" />
              {t("not_found.back")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;

