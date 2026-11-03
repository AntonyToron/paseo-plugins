import type { ChatEntry, IndexedMessage } from "./chat-index";
import type { SearchResult } from "../shared/contracts";

const MAX_RESULTS = 40;
const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 220;
// A message with the exact phrase beats one with every word, which beats one with a single
// common word ("token") by a wide margin.
const PHRASE_WEIGHT = 6;
const ALL_WORDS_WEIGHT = 3;
const SOME_WORDS_WEIGHT = 0.3;
const FROM_YOU_FACTOR = 1.5;
const TITLE_BONUS = 5;

export const terms = (query: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);

interface Scored {
  message: IndexedMessage;
  score: number;
}

function scoreMessage(message: IndexedMessage, words: readonly string[], phrase: string): Scored | null {
  const lower = message.text.toLowerCase();
  const found = words.filter((word) => lower.includes(word)).length;
  if (!found) return null;
  const weight =
    words.length > 1 && lower.includes(phrase) ? PHRASE_WEIGHT : found === words.length ? ALL_WORDS_WEIGHT : SOME_WORDS_WEIGHT;
  return { message, score: weight * (message.fromYou ? FROM_YOU_FACTOR : 1) };
}

function snippetOf(message: IndexedMessage, words: readonly string[], phrase: string): string {
  const lower = message.text.toLowerCase();
  const phraseAt = lower.indexOf(phrase);
  const first = phraseAt >= 0 ? phraseAt : Math.min(...words.map((word) => lower.indexOf(word)).filter((index) => index >= 0));
  const start = Math.max(0, first - SNIPPET_BEFORE);
  const text = message.text.slice(start, start + SNIPPET_LENGTH).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${start + SNIPPET_LENGTH < message.text.length ? "…" : ""}`;
}

/** A chat matches when every word appears somewhere in it, title included. */
export function search(entries: Iterable<ChatEntry>, query: string): SearchResult[] {
  const words = terms(query);
  if (!words.length) return [];
  const phrase = words.join(" ");
  // Ranked by the chat's best message, so a long chat can't win on a pile of weak matches.
  const results: (SearchResult & { best: number; score: number })[] = [];
  for (const entry of entries) {
    const title = entry.title.toLowerCase();
    const scored = entry.messages.map((message) => scoreMessage(message, words, phrase)).filter((hit): hit is Scored => hit !== null);
    const covered = words.every((word) => title.includes(word) || scored.some(({ message }) => message.text.toLowerCase().includes(word)));
    if (!covered) continue;
    const best = [...scored].sort((a, b) => b.score - a.score || b.message.at.localeCompare(a.message.at))[0];
    results.push({
      agentId: entry.agentId,
      title: entry.title,
      archived: entry.archived,
      at: best?.message.at ?? entry.messages.at(-1)?.at ?? "",
      snippet: best ? snippetOf(best.message, words, phrase) : "",
      fromYou: best?.message.fromYou ?? false,
      matches: scored.length,
      best: Math.max(best?.score ?? 0, words.every((word) => title.includes(word)) ? TITLE_BONUS : 0),
      score: scored.reduce((sum, hit) => sum + hit.score, 0) + (words.every((word) => title.includes(word)) ? TITLE_BONUS : 0),
    });
  }
  return results
    .sort((a, b) => b.best - a.best || b.score - a.score || b.at.localeCompare(a.at))
    .slice(0, MAX_RESULTS)
    .map(({ best: _best, score: _score, ...result }) => result);
}
