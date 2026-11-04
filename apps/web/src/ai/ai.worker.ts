/// <reference lib="webworker" />
import { SearchRequest, Searcher } from '@kydao/engine/ai';

const searcher = new Searcher();

self.onmessage = (e: MessageEvent<{ id: number; req: SearchRequest }>) => {
  const { id, req } = e.data;
  try {
    self.postMessage({ id, ok: true, result: searcher.search(req) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
