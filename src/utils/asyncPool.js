/**
 * Run async work over items with limited concurrency (batched parallelism).
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function asyncPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(concurrency || 1, list.length || 1));
  const results = new Array(list.length);
  let next = 0;

  async function run() {
    while (next < list.length) {
      const i = next++;
      results[i] = await worker(list[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => run()));
  return results;
}
