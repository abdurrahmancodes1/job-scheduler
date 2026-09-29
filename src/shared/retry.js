export function calculateRetryDelay(attempt) {
  const baseDelay = 2000;
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 1000);
  return exponentialDelay + jitter;
}
