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
  let creditFailure = null;

  async function worker() {
    while (true) {
      if (creditFailure) return;
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= pages.length) {
        return;
      }

      results[currentIndex] = await processPage(pages[currentIndex], context);
      if (results[currentIndex].creditUnavailable) creditFailure = results[currentIndex];
      completed += 1;

      if (typeof onProgress === "function") {
        await onProgress({
          completed,
          total: pages.length,
          pageNumber: pages[currentIndex].pageNumber,
          success: results[currentIndex].success,
          result: results[currentIndex],
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, pages.length) }, () => worker())
  );

  if (creditFailure) {
    console.warn('[PDF page queue] Stopped after API credit failure', {unsubmitted_pages:pages.filter((_,index)=>!results[index]).length});
    for (let index = 0; index < pages.length; index += 1) {
      if (results[index]) continue;
      results[index] = {...creditFailure,pageNumber:pages[index].pageNumber,skipped:true};
      completed += 1;
      if (typeof onProgress === 'function') await onProgress({completed,total:pages.length,pageNumber:pages[index].pageNumber,success:false,result:results[index]});
    }
  }

  return results;
}

export async function queuePages(jobId, pages) {
  return pages.map((page) => ({
    jobId,
    pageNumber: page.pageNumber,
    status: "pending",
  }));
}
