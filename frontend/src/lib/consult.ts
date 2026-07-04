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
import { dossierTiers, type DossierTierEntry } from "../data/dossierTiers";

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
// no tier, tag, or score (see gap research). We classify tier client-side,
// preferring the registry-derived dossierTiers map (document_name -> top
// available tier) and only falling back to a name heuristic for unknown docs.
// The ladder runs tier 4 (RCT, strongest) down to tier 1 (anecdote, weakest).

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

const LEVEL_TIERS: Record<ConsultTierLevel, ConsultTier> = {
  4: TIER_RCT,
  3: TIER_TRIAL,
  2: TIER_CASE,
  1: TIER_ANECDOTE,
};

/** Canonical form for a dossier document name: registered names derive from
 * hyphenated filenames ("Melanotan-II evidence dossier") while dossier titles
 * use the registry name ("Melanotan II evidence dossier"). Unifying case and
 * whitespace/hyphens lets the tier lookup hit whichever form Tavus echoes. */
function canonicalDocKey(name: string): string {
  return name.toLowerCase().replace(/[\s-]+/g, "-");
}

// Lazily built canonical-key index over dossierTiers (see canonicalDocKey).
let canonicalTiers: Record<string, DossierTierEntry> | null = null;

function lookupDossierTier(key: string): DossierTierEntry | undefined {
  const direct = dossierTiers[key];
  if (direct) return direct;
  if (!canonicalTiers) {
    canonicalTiers = {};
    for (const [name, entry] of Object.entries(dossierTiers)) {
      canonicalTiers[canonicalDocKey(name)] = entry;
    }
  }
  return canonicalTiers[canonicalDocKey(key)];
}

/**
 * Tier classification for a cited document's name. Tavus does not hand us a tier
 * on the event, so we first consult the registry-derived dossierTiers map
 * (document_name -> top available evidence tier, emitted by scripts/register_kb.py).
 * Only when the name is not a known dossier do we fall back to a name heuristic,
 * and to "Unrated" when even that matches nothing.
 */
export function classifyDocumentTier(documentName: string | null | undefined): ConsultTier {
  const raw = (documentName ?? "").trim();
  if (!raw) return TIER_UNKNOWN;

  // Registry-derived tier map wins: it is grounded in the dossier's actual tier
  // availability rather than substrings in the name. Tolerate a trailing ".md"
  // and the space vs hyphen divergence for multi-word compounds.
  const key = raw.replace(/\.md$/i, "").trim();
  const mapped = lookupDossierTier(key);
  if (mapped) return LEVEL_TIERS[mapped.level];

  const name = raw.toLowerCase();
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
  // Only real LLM function calls. Match the tool_call suffix (prefix-agnostic) but
  // exclude conversation.perception_tool_call, which the raven/perception layer
  // emits and which our backend dispatcher does not answer.
  const type = eventType(msg);
  if (!type.endsWith("tool_call") || type.includes("perception")) return null;

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
      // Fall back to the document name, not an index: `doc-${i}` repeats across
      // separate events and would make the Sources dedup drop distinct citations.
      documentId: ids[i] ?? documentName,
      documentName,
      tier: classifyDocumentTier(documentName),
    });
  }
  return events;
}

// ------------------------------------------------------- tool-sourced citations
// get_compound_evidence returns the tier ladder (evidence_sources) plus the
// underlying tables, but Tavus does not reliably fire a rag.observability event
// for a tool-sourced answer -- so the Sources panel would stay empty even though
// the persona just cited evidence. parseEvidenceSources maps each AVAILABLE tier
// from the tool result into a citation event, phrasing the document name so
// classifyDocumentTier lands on the same level the backend assigned (display_tier)
// and keying the id to compound + tier so repeat lookups for one compound dedup.

interface RawEvidenceSource {
  id?: unknown;
  label?: unknown;
  display_tier?: unknown;
  count?: unknown;
  available?: unknown;
}

interface RawEvidenceResult {
  found?: unknown;
  compound_id?: unknown;
  name?: unknown;
  compound_name?: unknown;
  evidence_sources?: unknown;
}

// Tier-aligned phrasing per evidence-source id (see evidence.py _evidence_sources).
// Each phrase is chosen so classifyDocumentTier's name heuristic returns the tier
// the backend already assigned: rct -> 4, observational -> 3, quality -> 2 (case
// series), anecdote -> 1.
const EVIDENCE_SOURCE_PHRASES: Record<string, string> = {
  rct: "randomized controlled trials",
  observational: "observational studies and papers",
  quality: "verified real-world case series",
  anecdote: "community anecdotes and forum reports",
};

/**
 * Map a get_compound_evidence tool result into RAG citation events, one per
 * available evidence tier. Returns [] when the compound was not found or no tier
 * has evidence, so the caller can hand the result straight to addSources.
 */
export function parseEvidenceSources(result: unknown): RagObservabilityEvent[] {
  const rec = asRecord(result) as RawEvidenceResult | null;
  if (!rec || rec.found !== true) return [];

  const rawSources = Array.isArray(rec.evidence_sources) ? rec.evidence_sources : [];
  if (rawSources.length === 0) return [];

  const compoundName =
    (typeof rec.name === "string" && rec.name) ||
    (typeof rec.compound_name === "string" && rec.compound_name) ||
    "Compound";
  // Prefer the numeric compound id for a stable dedup key; fall back to the name.
  const compoundKey =
    rec.compound_id !== undefined && rec.compound_id !== null
      ? String(rec.compound_id)
      : compoundName.toLowerCase();

  const events: RagObservabilityEvent[] = [];
  for (const raw of rawSources) {
    const src = asRecord(raw) as RawEvidenceSource | null;
    if (!src || src.available !== true) continue;
    const id = typeof src.id === "string" ? src.id : "";
    if (!id) continue;
    const phrase =
      EVIDENCE_SOURCE_PHRASES[id] ?? (typeof src.label === "string" ? src.label : id);
    const count = typeof src.count === "number" ? src.count : 0;
    const documentName =
      count > 0 ? `${compoundName}: ${phrase} (${count})` : `${compoundName}: ${phrase}`;
    events.push({
      documentId: `evidence:${compoundKey}:${id}`,
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
  | "submit_trial_intake"
  | "submit_intake"
  | "intake";

const INTAKE_ENDPOINT = `${API_BASE}/consult/intake`;

/** Map a persona tool name to the backend endpoint that answers it.
 * The persona registers the intake tool as `submit_trial_intake`
 * (scripts/persona_config.json); the aliases are kept for compatibility. */
function toolEndpoint(name: string): string | null {
  switch (name) {
    case "get_compound_evidence":
      return `${API_BASE}/consult/tools/get_compound_evidence`;
    case "screen_eligibility":
      return `${API_BASE}/consult/tools/screen_eligibility`;
    case "submit_trial_intake":
    case "submit_intake":
    case "intake":
      return INTAKE_ENDPOINT;
    default:
      return null;
  }
}

/**
 * Forward a tool call to its backend endpoint and return the parsed JSON result.
 * Throws when the tool name is unknown or the request fails, so the caller can
 * surface an error rather than silently drop the persona's request.
 *
 * For the intake tool the authenticated `userRef` is injected AFTER the persona
 * args, so the stored trial_intakes row is keyed to the real signed-in user and
 * a persona-invented user_ref can never win.
 */
export async function dispatchToolCall(
  evt: ToolCallEvent,
  userRef?: string,
): Promise<unknown> {
  const endpoint = toolEndpoint(evt.name);
  if (!endpoint) {
    throw new Error(`Unknown consult tool: ${evt.name}`);
  }
  const body: Record<string, unknown> =
    endpoint === INTAKE_ENDPOINT && userRef
      ? { ...evt.args, user_ref: userRef }
      : evt.args;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `tool ${evt.name} failed (${res.status})`);
  }
  return res.json() as Promise<unknown>;
}

/**
 * Return a tool result to the running conversation over the Daily data channel.
 * Tavus pairs the in-flight tool call to its answer via the tool_call_id and then
 * resumes the persona's turn. The correct interaction is `conversation.tool_result`
 * with { tool_call_id, output, status } (docs.tavus.io/sections/event-schemas/
 * conversation-tool-result) -- NOT `conversation.respond`, which injects text as a
 * fresh user utterance and carries no tool_call_id, leaving the tool call unfulfilled.
 * `output` accepts a string or object; we serialize to a string for a stable shape.
 */
export function sendToolResult(
  call: DailyCall,
  toolCallId: string,
  result: unknown,
  status: "success" | "error" = "success",
): void {
  const message = {
    message_type: "conversation",
    event_type: "conversation.tool_result",
    properties: {
      tool_call_id: toolCallId,
      output: JSON.stringify(result),
      status,
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
