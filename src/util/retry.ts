/**
 * Retry tối đa `maxAttempts` lần với backoff tăng dần (500ms, 1000ms, ...) khi `fn` thất bại —
 * dùng cho mọi lời gọi API bên ngoài (Facebook Send API, Sheets API) theo mục 10.
 * Dùng chung giữa webhook/facebook.ts và services/sheetsService.ts, tránh trùng lặp code.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError;
}
