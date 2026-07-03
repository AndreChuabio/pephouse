// Consult client: typed helpers for the Tavus CVI clinician front.
//
// A consult session mints a Tavus conversation server-side (the TAVUS_API_KEY
// never reaches the browser). Tavus delivers tool calls and RAG-citation events
// as `app_message` payloads over the Daily data channel. This module owns:
//   - startConsultSession: mint the conversation (backend POST /consult/session)
//   - parseToolCall / parseRagObservability: narrow raw Daily app-messages into
//     typed events (no `any`)
//   - dispatchToolCall: forward a tool call to the matching backend endpoint
//   - sendToolResult: hand the backend result back to the conversation
//   - classifyDocumentTier: map a cited document name to an evidence tier so the
//     Sources panel can badge it (Tavus does not put a tier on the event)
//
// The Daily call object (DailyCall) is created in ConsultPage via
// DailyIframe.createFrame; this module only produces/consumes the payloads.

import type { DailyCall } from "@daily-co/daily-js";

const API_BASE =
  import.meta.env.VITE_API_URL ??
  "https://pephouse-backend-production.up.railway.app";

// =============================================================== session mint

export interface ConsultSession {
  conversation_url: string;
  conversation_id: string;
  pal_id: string;
}

/**
 * Mint a Tavus conversation for this member. The backend PHI-minimizes the
 * stored bundle into the conversational context; the browser only receives the
 * join URL and ids.
 */
export async function startConsultSession(
  userRef?: string,
  goal?: string,
  compoundName?: string,
): Promise<ConsultSession> {
  const body: Record<string, string> = {};
  if (userRef) body.user_ref = userRef;
  if (goal) body.goal = goal;
  if (compoundName) body.compound_name = compoundName;

  const res = await fetch(`${API_BASE}/consult/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `consult session failed (${res.status})`);
  }
  return res.json() as Promise<ConsultSession>;
}

// ============================================================ evidence tiers
// Tavus rag.observability events carry only document_ids and document_names -
// no tier, tag, or score (see gap research). We therefore classify tier from
// the document name client-side. Dossiers are named with a tier keyword; the
// ladder runs tier 4 (RCT, strongest) down to tier 1 (anecdote, weakest).

export type ConsultTierLevel = 1 | 2 | 3 | 4;

export interface ConsultTier {
  level: ConsultTierLevel;
  label: string;
  /** Tailwind classes for a badge, distinct per tier. */
  className: string;
}

const TIER_RCT: ConsultTier = {
  level: 4,
  label: "RCT",
  className:
    "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25",
};
const TIER_TRIAL: ConsultTier = {
  level: 3,
  label: "Trial",
  className: "bg-sky-500/10 text-sky-400 border border-sky-500/25",
};
const TIER_CASE: ConsultTier = {
  level: 2,
  label: "Case Study",
  className: "bg-amber-500/10 text-amber-400 border border-amber-500/25",
};
const TIER_ANECDOTE: ConsultTier = {
  level: 1,
  label: "Anecdote",
  className: "bg-orange-500/10 text-orange-400 border border-orange-500/25",
};
const TIER_UNKNOWN: ConsultTier = {
  level: 1,
  label: "Unrated",
  className: "bg-zinc-800 text-zinc-400 border border-zinc-700/60",
};

/**
 * Best-effort tier classification from a cited document's name. Tavus does not
 * hand us a tier on the event, so we key off dossier naming conventions and fall
 * back to "Unrated" when nothing matches.
 */
export function classifyDocumentTier(documentName: string | null | undefined): ConsultTier {
  const name = (documentName ?? "").toLowerCase();
  if (!name) return TIER_UNKNOWN;
  if (/\brct\b|randomi[sz]ed|placebo|double-?blind/.test(name)) return TIER_RCT;
  if (/\btrial\b|cohort|clinical|phase\s?[i1-4]|observational/.test(name)) return TIER_TRIAL;
  if (/case[\s_-]?study|case[\s_-]?report|case[\s_-]?series/.test(name)) return TIER_CASE;
  if (/anecdote|anecdotal|forum|reddit|self[\s_-]?report|testimonial/.test(name)) {
    return TIER_ANECDOTE;
  }
  return TIER_UNKNOWN;
}

// =============================================================== event types

export interface RagObservabilityEvent {
  documentId: string;
  documentName: string;
  tier?: ConsultTier;
}

/** A tool call raised by the persona over the Daily data channel. */
export interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  tool_call_id: string;
}

// ----------------------------------------------------------- raw app-message

interface TavusAppMessage {
  message_type?: string;
  event_type?: string;
  conversation_id?: string;
  inference_id?: string;
  properties?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asTavusMessage(data: unknown): TavusAppMessage | null {
  const rec = asRecord(data);
  if (!rec) return null;
  return rec as TavusAppMessage;
}

function eventType(msg: TavusAppMessage): string {
  return (msg.event_type ?? "").toLowerCase();
}

function coerceArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      const rec = asRecord(parsed);
      return rec ?? {};
    } catch {
      return {};
    }
  }
  const rec = asRecord(raw);
  return rec ?? {};
}

function coerceStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => (typeof v === "string" ? v : String(v)));
  }
  if (typeof raw === "string" && raw) return [raw];
  return [];
}

/**
 * Narrow a Daily app-message into a ToolCallEvent, or null if it is not one.
 * Tavus nests the tool name and arguments under `properties`; arguments may be a
 * JSON string. The id falls back to inference_id, then a generated value.
 */
export function parseToolCall(data: unknown): ToolCallEvent | null {
  const msg = asTavusMessage(data);
  if (!msg) return null;
  if (!eventType(msg).includes("tool_call")) return null;

  const props = msg.properties ?? {};
  const name = typeof props.name === "string" ? props.name : "";
  if (!name) return null;

  const args = coerceArgs(props.arguments ?? props.args ?? props.parameters);
  const idCandidate =
    (typeof props.tool_call_id === "string" && props.tool_call_id) ||
    (typeof msg.inference_id === "string" && msg.inference_id) ||
    `${name}-${Date.now()}`;

  return { name, args, tool_call_id: idCandidate };
}

/**
 * Narrow a Daily app-message into RAG citation events (one per cited document),
 * or null if it is not a rag.observability message. Tier is filled in from the
 * document name via classifyDocumentTier.
 */
export function parseRagObservability(data: unknown): RagObservabilityEvent[] | null {
  const msg = asTavusMessage(data);
  if (!msg) return null;
  const type = eventType(msg);
  if (!type.includes("rag") || !type.includes("observability")) return null;

  const props = msg.properties ?? {};
  const ids = coerceStringArray(props.document_ids ?? props.documentIds);
  const names = coerceStringArray(props.document_names ?? props.documentNames);
  const count = Math.max(ids.length, names.length);
  if (count === 0) return [];

  const events: RagObservabilityEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const documentName = names[i] ?? "Untitled document";
    events.push({
      documentId: ids[i] ?? `doc-${i}`,
      documentName,
      tier: classifyDocumentTier(documentName),
    });
  }
  return events;
}

// ============================================================ tool dispatch

export type ConsultToolName =
  | "get_compound_evidence"
  | "screen_eligibility"
  | "submit_intake"
  | "intake";

/** Map a persona tool name to the backend endpoint that answers it. */
function toolEndpoint(name: string): string | null {
  switch (name) {
    case "get_compound_evidence":
      return `${API_BASE}/consult/tools/get_compound_evidence`;
    case "screen_eligibility":
      return `${API_BASE}/consult/tools/screen_eligibility`;
    case "submit_intake":
    case "intake":
      return `${API_BASE}/consult/intake`;
    default:
      return null;
  }
}

/**
 * Forward a tool call to its backend endpoint and return the parsed JSON result.
 * Throws when the tool name is unknown or the request fails, so the caller can
 * surface an error rather than silently drop the persona's request.
 */
export async function dispatchToolCall(evt: ToolCallEvent): Promise<unknown> {
  const endpoint = toolEndpoint(evt.name);
  if (!endpoint) {
    throw new Error(`Unknown consult tool: ${evt.name}`);
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(evt.args),
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `tool ${evt.name} failed (${res.status})`);
  }
  return res.json() as Promise<unknown>;
}

/**
 * Return a tool result to the running conversation over the Daily data channel.
 * Tavus consumes a `conversation.respond` interaction as fresh context for the
 * LLM turn; we serialize the backend result and tag it with the tool_call_id so
 * the persona can tie the answer back to its request.
 */
export function sendToolResult(
  call: DailyCall,
  toolCallId: string,
  result: unknown,
): void {
  const message = {
    message_type: "conversation",
    event_type: "conversation.respond",
    properties: {
      tool_call_id: toolCallId,
      text: JSON.stringify(result),
    },
  };
  call.sendAppMessage(message, "*");
}

// =============================================================== intake queue
// Shared shape for the Coordinator queue (GET /consult/intakes). The backend
// returns the raw trial_intakes rows.

export type Eligibility = "eligible" | "excluded" | "no_trial" | "unknown";

export interface TrialIntakeRow {
  id: number;
  user_ref: string;
  goal: string | null;
  compound_id: number | null;
  compound_name: string | null;
  eligibility: Eligibility;
  eligibility_reason: string | null;
  consent: boolean;
  context_snapshot: Record<string, unknown> | null;
  counsel_summary: string | null;
  status: string | null;
  created_at: string | null;
}

/** Read the coordinator queue, most recent first. */
export async function fetchIntakes(limit = 100): Promise<TrialIntakeRow[]> {
  const res = await fetch(`${API_BASE}/consult/intakes?limit=${limit}`);
  if (!res.ok) {
    throw new Error((await res.text()) || `intakes failed (${res.status})`);
  }
  return res.json() as Promise<TrialIntakeRow[]>;
}
