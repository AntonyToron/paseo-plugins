import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Indexer } from "./server/indexer";
import { search } from "./server/search";
import { searchChats } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const indexer = new Indexer();
  server.handle(searchChats, async ({ query }, { paseo }) => {
    indexer.refresh(paseo);
    return { indexing: indexer.status(), indexError: indexer.error(), results: search(await indexer.entries(), query) };
  });
  return async () => {
    await indexer.flush();
  };
}
