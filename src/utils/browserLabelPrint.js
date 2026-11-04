/**
 * Promise helpers around BarcodePrintSheet lifecycle (parent mounts the sheet).
 */

export function createBrowserPrintSession() {
  let resolveFn;
  let rejectFn;
  const done = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    done,
    resolve: (v) => resolveFn?.(v),
    reject: (e) => rejectFn?.(e),
  };
}
