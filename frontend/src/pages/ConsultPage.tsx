import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import DailyIframe, {
  type DailyCall,
  type DailyEventObjectAppMessage,
} from "@daily-co/daily-js";
import { AppShell } from "../components/layout/AppShell";
import { Panel } from "../components/ui/Panel";
import { PanelHeader } from "../components/ui/PanelHeader";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { getUserRef } from "../lib/userRef";
import {
  dispatchToolCall,
  parseRagObservability,
  parseToolCall,
  sendToolResult,
  startConsultSession,
  type ConsultSession,
  type RagObservabilityEvent,
  type ToolCallEvent,
} from "../lib/consult";

// The consult surface is delivered as a Tavus CVI conversation. We embed the
// room with DailyIframe.createFrame (renders the persona video + local camera)
// AND keep the returned call object so we can subscribe to the Daily data
// channel. Tavus tools use `app_message` delivery: tool calls and RAG-citation
// events arrive as app-messages here, we answer tool calls from our backend and
// return the result to the conversation. cvi-ui was skipped in favour of
// daily-js directly - it is the framework-agnostic fallback and avoids codegen.

type ToolStatus = "running" | "done" | "error";

interface ToolActivity {
  id: string;
  name: string;
  status: ToolStatus;
  detail?: string;
  at: string;
}

interface SourceEntry extends RagObservabilityEvent {
  seenAt: string;
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined || value === "") continue;
    const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(`${key}: ${rendered}`);
  }
  return parts.join(", ");
}

export default function ConsultPage() {
  useDocumentTitle("PepHouse | Consult");

  const [session, setSession] = useState<ConsultSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [activity, setActivity] = useState<ToolActivity[]>([]);

  const callRef = useRef<DailyCall | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Identity the consult was started (and its data bundle seeded) with. Tool
  // calls key intake rows to THIS value, not a fresh getUserRef(), so an auth
  // state change mid-consult (late anonymous sign-in resolving, sign-out) can
  // never flip the intake to a different user than the one counseled.
  const consultUserRef = useRef<string | null>(null);
  // Holds the in-flight destroy() of a prior frame. daily-js forbids two live
  // DailyIframe instances, so a re-mount (React 18 StrictMode double-invoke, or
  // any effect re-run) must wait for the previous frame to finish tearing down
  // before creating the next one.
  const teardownRef = useRef<Promise<void>>(Promise.resolve());

  const addSources = useCallback((events: RagObservabilityEvent[]) => {
    if (events.length === 0) return;
    setSources((prev) => {
      const next = [...prev];
      for (const evt of events) {
        const exists = next.some((s) => s.documentId === evt.documentId);
        if (!exists) next.unshift({ ...evt, seenAt: nowLabel() });
      }
      return next.slice(0, 40);
    });
  }, []);

  const upsertActivity = useCallback((entry: ToolActivity) => {
    setActivity((prev) => {
      const idx = prev.findIndex((a) => a.id === entry.id);
      if (idx === -1) return [entry, ...prev].slice(0, 40);
      const next = [...prev];
      next[idx] = entry;
      return next;
    });
  }, []);

  // Answer a persona tool call from our backend, then return the result to the
  // conversation over the data channel. A failure is surfaced in the feed and
  // still echoed back so the persona is not left waiting.
  const handleToolCall = useCallback(
    async (evt: ToolCallEvent, call: DailyCall) => {
      upsertActivity({
        id: evt.tool_call_id,
        name: evt.name,
        status: "running",
        detail: summarizeArgs(evt.args),
        at: nowLabel(),
      });
      try {
        const result = await dispatchToolCall(evt, consultUserRef.current ?? getUserRef());
        sendToolResult(call, evt.tool_call_id, result);
        upsertActivity({
          id: evt.tool_call_id,
          name: evt.name,
          status: "done",
          detail: summarizeArgs(evt.args),
          at: nowLabel(),
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : "tool failed";
        sendToolResult(call, evt.tool_call_id, { error: detail }, "error");
        upsertActivity({
          id: evt.tool_call_id,
          name: evt.name,
          status: "error",
          detail,
          at: nowLabel(),
        });
      }
    },
    [upsertActivity],
  );

  const handleAppMessage = useCallback(
    (event: DailyEventObjectAppMessage) => {
      const data: unknown = event.data;
      const call = callRef.current;

      const rag = parseRagObservability(data);
      if (rag) {
        addSources(rag);
        return;
      }

      const tool = parseToolCall(data);
      if (tool && call) {
        void handleToolCall(tool, call);
      }
    },
    [addSources, handleToolCall],
  );

  const start = useCallback(async () => {
    if (starting || session) return;
    setError(null);
    setStarting(true);
    try {
      // Capture the identity once: the session context and every later tool
      // call (including the trial intake) are keyed to the same user_ref.
      const ref = getUserRef();
      const s = await startConsultSession(ref);
      if (!s.conversation_url) {
        throw new Error("consult session returned no conversation_url");
      }
      consultUserRef.current = ref;
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not start consult");
    } finally {
      setStarting(false);
    }
  }, [session, starting]);

  // Mount the Daily frame once we have a session and the container is rendered.
  // Creation is chained onto any prior frame's teardown so two DailyIframe
  // instances never overlap (see teardownRef).
  useEffect(() => {
    if (!session) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    teardownRef.current = teardownRef.current.then(() => {
      if (cancelled || callRef.current) return;
      const call = DailyIframe.createFrame(container, {
        showLeaveButton: true,
        iframeStyle: {
          width: "100%",
          height: "100%",
          border: "0",
          borderRadius: "12px",
        },
      });
      callRef.current = call;
      call.on("app-message", handleAppMessage);
      call.join({ url: session.conversation_url }).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "could not join conversation");
        // A failed join leaves a dead frame with no controls. Clear the session
        // so the effect cleanup destroys the frame and the Start button returns.
        setSession(null);
      });
    });

    return () => {
      cancelled = true;
      const call = callRef.current;
      callRef.current = null;
      if (!call) return;
      call.off("app-message", handleAppMessage);
      teardownRef.current = call.destroy().catch(() => {
        // frame already torn down; nothing to recover
      });
    };
  }, [session, handleAppMessage]);

  return (
    <AppShell>
      <header className="h-16 flex items-center justify-between px-8 border-b border-zinc-800/60 shrink-0 z-10 bg-zinc-950/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold tracking-tight text-white flex items-center gap-2">
            <Icon icon="solar:videocamera-record-linear" className="text-blue-400 text-xl" />
            Consult
          </h1>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-full">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                session ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
              }`}
            />
            {session ? "Live consult" : "Not connected"}
          </div>
        </div>
        {!session && (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-60 transition-colors text-sm font-medium px-4 py-1.5 rounded-md shadow-sm"
          >
            {starting ? "Starting…" : "Start consult"}
          </button>
        )}
      </header>

      <div className="flex-1 min-h-0 flex gap-4 p-4 overflow-hidden">
        {/* Center: the video call */}
        <div className="flex-1 min-w-0 flex flex-col">
          <Panel className="flex-1 min-h-0 flex flex-col overflow-hidden p-0">
            {session ? (
              <div ref={containerRef} className="flex-1 min-h-0 w-full bg-black rounded-xl" />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
                <div className="h-14 w-14 rounded-full bg-zinc-800/70 border border-zinc-700 flex items-center justify-center">
                  <Icon icon="solar:videocamera-record-linear" className="text-2xl text-zinc-400" />
                </div>
                <div>
                  <p className="text-white font-medium">Start a consult</p>
                  <p className="text-sm text-zinc-500 max-w-sm mt-1">
                    A clinician persona reviews your connected data and the evidence
                    ladder with you. Tool calls and cited sources appear on the right in
                    real time.
                  </p>
                </div>
                {error && (
                  <p className="text-sm text-red-400 max-w-sm">{error}</p>
                )}
                <button
                  type="button"
                  onClick={start}
                  disabled={starting}
                  className="bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-60 transition-colors text-sm font-medium px-5 py-2 rounded-md shadow-sm"
                >
                  {starting ? "Starting…" : "Start consult"}
                </button>
              </div>
            )}
          </Panel>
          {session && error && (
            <p className="text-sm text-red-400 mt-2 px-1">{error}</p>
          )}
        </div>

        {/* Right rail: sources, tool activity, disclaimer */}
        <div className="w-80 shrink-0 flex flex-col gap-4 overflow-hidden">
          <Panel className="p-4 flex-1 min-h-0 flex flex-col overflow-hidden">
            <PanelHeader icon="solar:documents-linear" title="Sources" />
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {sources.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Cited evidence appears here as the persona draws on the knowledge base.
                </p>
              ) : (
                sources.map((s) => (
                  <div
                    key={s.documentId}
                    className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          s.tier?.className ?? "bg-zinc-800 text-zinc-400 border border-zinc-700/60"
                        }`}
                      >
                        {s.tier ? `T${s.tier.level} ${s.tier.label}` : "Unrated"}
                      </span>
                      <span className="text-[10px] text-zinc-600 shrink-0">{s.seenAt}</span>
                    </div>
                    <p className="text-xs text-zinc-300 leading-snug break-words">
                      {s.documentName}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel className="p-4 flex-1 min-h-0 flex flex-col overflow-hidden">
            <PanelHeader icon="solar:bolt-linear" title="Tool activity" />
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {activity.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Evidence lookups and eligibility screens the persona runs appear here.
                </p>
              ) : (
                activity.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                        <StatusDot status={a.status} />
                        {a.name}
                      </span>
                      <span className="text-[10px] text-zinc-600 shrink-0">{a.at}</span>
                    </div>
                    {a.detail && (
                      <p className="text-[11px] text-zinc-500 leading-snug break-words">
                        {a.detail}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel className="p-3">
            <p className="text-[11px] text-zinc-500 leading-snug flex items-start gap-2">
              <Icon
                icon="solar:info-circle-linear"
                className="text-zinc-600 mt-0.5 shrink-0"
              />
              For education, not medical advice. Nothing here is a diagnosis or a
              prescription. Consult a licensed clinician before acting.
            </p>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}

function StatusDot({ status }: { status: ToolStatus }) {
  const cls =
    status === "running"
      ? "bg-sky-500 animate-pulse"
      : status === "done"
        ? "bg-emerald-500"
        : "bg-red-500";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} />;
}
