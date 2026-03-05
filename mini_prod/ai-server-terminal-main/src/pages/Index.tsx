import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAuthSession } from "@/lib/api";

const Index = () => {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: fetchAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (data) {
      navigate("/dashboard", { replace: true });
    }
  }, [data, navigate]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="enterprise-panel flex min-w-[260px] items-center gap-3 rounded-3xl px-5 py-4 text-sm text-muted-foreground">
        <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
        Redirecting to dashboard…
      </div>
    </div>
  );
};

export default Index;
