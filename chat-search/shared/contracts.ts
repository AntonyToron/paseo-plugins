import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const searchResult = z.object({
  agentId: z.string(),
  title: z.string(),
  at: z.string(),
  archived: z.boolean(),
  /** A stretch of the best-matching message, with the match near the start. */
  snippet: z.string(),
  fromYou: z.boolean(),
  matches: z.number(),
});
export type SearchResult = z.infer<typeof searchResult>;

export const searchChats = defineRpc({
  name: "chat-search.search",
  input: z.object({ query: z.string() }),
  output: z.object({
    indexing: z.object({ done: z.number(), total: z.number() }).nullable(),
    indexError: z.string().nullable(),
    results: z.array(searchResult),
  }),
});
