import Papa from "papaparse";
import csvText from "./tweets.csv?raw";

export type Tweet = {
  permalink: string;
  body: string;
  claimed_effect: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  dose_mentioned: string | null;
};

type Row = {
  compound_name: string;
  permalink: string;
  body: string;
  claimed_effect: string;
  sentiment: string;
  dose_mentioned: string;
};

const VALID_SENTIMENTS = new Set(["positive", "negative", "mixed", "neutral"]);

const { data } = Papa.parse<Row>(csvText, { header: true, skipEmptyLines: true });

export const TWEETS_BY_COMPOUND: Record<string, Tweet[]> = data.reduce((acc, row) => {
  const compound = row.compound_name?.trim();
  if (!compound) return acc;
  const raw = row.sentiment?.trim().toLowerCase() ?? "neutral";
  const sentiment = (VALID_SENTIMENTS.has(raw) ? raw : "neutral") as Tweet["sentiment"];
  const dose = row.dose_mentioned?.trim();
  (acc[compound] ??= []).push({
    permalink: row.permalink?.trim() ?? "",
    body: row.body ?? "",
    claimed_effect: row.claimed_effect ?? "",
    sentiment,
    dose_mentioned: dose ? dose : null,
  });
  return acc;
}, {} as Record<string, Tweet[]>);

export function tweetsForCompound(name: string | undefined): Tweet[] {
  if (!name) return [];
  if (TWEETS_BY_COMPOUND[name]) return TWEETS_BY_COMPOUND[name];
  const key = Object.keys(TWEETS_BY_COMPOUND).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? TWEETS_BY_COMPOUND[key] : [];
}
