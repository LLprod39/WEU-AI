import { useParams } from "react-router-dom";
import { fetchFrontendBootstrap, getRdpPath } from "@/lib/api";
import { Monitor, ExternalLink, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

export default function RdpPage() {
  const { id } = useParams<{ id: string }>();
  const requestedId = Number(id || 0);
  const { data, isLoading, error } = useQuery({
    queryKey: ["frontend", "bootstrap"],
    queryFn: fetchFrontendBootstrap,
    staleTime: 20_000,
  });
  const server = data?.servers.find((s) => s.id === requestedId);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading RDP...</div>;
  }
  if (error || !server) {
    return <div className="p-6 text-sm text-destructive">RDP server not found.</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="flex items-center gap-3 px-4 py-2 bg-card border-b border-border shrink-0">
        <Monitor className="h-4 w-4 text-info" />
        <span className="text-sm font-medium text-foreground">{server?.name || `Server ${id}`}</span>
        <span className="text-xs text-muted-foreground font-mono">{server.host}:{server.port}</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          aria-label="Open native RDP page"
          onClick={() => {
            window.location.href = getRdpPath(server.id);
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" aria-label="Disconnect">
          <Power className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 flex items-center justify-center bg-terminal-bg">
        <div className="text-center space-y-3">
          <Monitor className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">RDP session is handled by Django legacy page.</p>
          <p className="text-xs text-muted-foreground">Click top-right icon to open native RDP view.</p>
        </div>
      </div>
    </div>
  );
}
