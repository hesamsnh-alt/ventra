import { processPage } from "@/services/pageWorker";

export async function runPageQueue({
  pages,
  context = {},
  concurrency = 2,
  onProgress = null,
}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(Number(concurrency) || 1, 4));
  const results = new Array(pages.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= pages.length) {
        return;
      }

      results[currentIndex] = await processPage(pages[currentIndex], context);
      completed += 1;

      if (typeof onProgress === "function") {
        await onProgress({
          completed,
          total: pages.length,
          pageNumber: pages[currentIndex].pageNumber,
          success: results[currentIndex].success,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, pages.length) }, () => worker())
  );

  return results;
}

export async function queuePages(jobId, pages) {
  return pages.map((page) => ({
    jobId,
    pageNumber: page.pageNumber,
    status: "pending",
  }));
}
