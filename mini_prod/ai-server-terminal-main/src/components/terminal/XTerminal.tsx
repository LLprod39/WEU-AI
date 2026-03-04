import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { getWsUrl, fetchWsToken } from "@/lib/api";

export type TerminalConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export type AiExecutionMode = "auto" | "step" | "fast";

export interface TerminalHandle {
  sendAiRequest: (message: string, mode?: AiExecutionMode) => void;
  stopAi: () => void;
  sendAiReply: (qId: string, text: string) => void;
  sendAiConfirm: (id: number) => void;
  sendAiCancel: (id: number) => void;
  clearTerminal: () => void;
}

interface XTerminalProps {
  serverId: number;
  onStatusChange?: (status: TerminalConnectionStatus) => void;
  onError?: (message: string) => void;
  onEvent?: (payload: Record<string, unknown>) => void;
}

export const XTerminal = forwardRef<TerminalHandle, XTerminalProps>(function XTerminal(
  { serverId, onStatusChange, onError, onEvent }: XTerminalProps,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsOpenedRef = useRef(false);

  // Store callbacks in refs so the WebSocket effect doesn't restart on every render.
  const onStatusChangeRef = useRef(onStatusChange);
  const onErrorRef = useRef(onError);
  const onEventRef = useRef(onEvent);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; });
  useEffect(() => { onErrorRef.current = onError; });
  useEffect(() => { onEventRef.current = onEvent; });

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', monospace",
      theme: {
        background: "#0a0e14",
        foreground: "#a3be8c",
        cursor: "#22b8cf",
        selectionBackground: "#22b8cf33",
        black: "#1a1e24",
        red: "#e06c75",
        green: "#a3be8c",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#22b8cf",
        white: "#abb2bf",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#a3be8c",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#22b8cf",
        brightWhite: "#ffffff",
      },
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(containerRef.current);

    setTimeout(() => fit.fit(), 50);
    term.writeln("\x1b[36mWebTermAI\x1b[0m");
    term.writeln(`\x1b[90mConnecting to server #${serverId}...\x1b[0m`);

    termRef.current = term;
    fitRef.current = fit;

    const sendJson = (payload: Record<string, unknown>) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(payload));
    };

    // Fetch a short-lived WS auth token. This is needed when the Vite dev
    // proxy doesn't forward the session Cookie on WebSocket upgrades.
    let cancelled = false;
    fetchWsToken().then((wsToken) => {
      if (cancelled) return;
      const wsUrl = getWsUrl(serverId, wsToken ?? undefined);
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      wsOpenedRef.current = false;
      onStatusChangeRef.current?.("connecting");

      socket.onopen = () => {
        wsOpenedRef.current = true;
        const cols = term.cols || 120;
        const rows = term.rows || 32;
        term.writeln("\x1b[90mWebSocket connected. Starting SSH session...\x1b[0m");
        sendJson({ type: "connect", cols, rows, term_type: "xterm-256color" });
      };

      socket.onmessage = (event) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        onEventRef.current?.(payload);
        const type = String(payload.type || "");
        if (type === "output") {
          const chunk = String(payload.data || "");
          term.write(chunk);
          return;
        }
        if (type === "status") {
          const status = String(payload.status || "disconnected") as TerminalConnectionStatus;
          onStatusChangeRef.current?.(status);
          if (status === "disconnected") {
            term.writeln("\r\n\x1b[33mConnection closed.\x1b[0m");
          }
          return;
        }
        if (type === "error") {
          const message = String(payload.message || "Terminal error");
          onStatusChangeRef.current?.("error");
          onErrorRef.current?.(message);
          term.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
          return;
        }
        if (type === "exit") {
          const exitStatus = payload.exit_status;
          term.writeln(`\r\n\x1b[33mProcess exited (${String(exitStatus)})\x1b[0m`);
        }
      };

      socket.onerror = () => {
        const message = "WebSocket error while connecting to terminal";
        onStatusChangeRef.current?.("error");
        onErrorRef.current?.(message);
        term.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
      };

      socket.onclose = (event) => {
        const details = event.reason
          ? `code ${event.code}: ${event.reason}`
          : `code ${event.code}`;
        const message = wsOpenedRef.current
          ? `WebSocket closed (${details})`
          : `WebSocket handshake failed (${details}). Check frontend host, proxy, and WS URL.`;
        onStatusChangeRef.current?.("disconnected");
        onErrorRef.current?.(message);
        term.writeln(`\r\n\x1b[33m${message}\x1b[0m`);
      };
    });
    onStatusChangeRef.current?.("connecting");

    term.onData((data) => {
      sendJson({ type: "input", data });
    });

    const handleResize = () => fit.fit();
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    const resizeTimer = setInterval(() => {
      fit.fit();
      sendJson({ type: "resize", cols: term.cols, rows: term.rows });
    }, 600);

    return () => {
      cancelled = true;
      clearInterval(resizeTimer);
      observer.disconnect();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "disconnect" }));
        wsRef.current.close();
      }
      wsRef.current = null;
      term.dispose();
    };
  }, [serverId]); // callbacks are accessed via refs — no restart on prop change

  useImperativeHandle(ref, () => ({
    sendAiRequest: (message: string, mode?: AiExecutionMode) => {
      if (!message.trim()) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ type: "ai_request", message, execution_mode: mode || "auto" }));
    },
    stopAi: () => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ type: "ai_stop" }));
    },
    sendAiReply: (qId: string, text: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ type: "ai_reply", q_id: qId, text }));
    },
    sendAiConfirm: (id: number) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ type: "ai_confirm", id }));
    },
    sendAiCancel: (id: number) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ type: "ai_cancel", id }));
    },
    clearTerminal: () => {
      termRef.current?.clear();
    },
  }));

  useEffect(() => {
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full min-h-[200px]" />;
});
