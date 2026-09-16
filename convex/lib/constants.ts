export const PLATFORM_FEE_RATE = 0.0425;

export function resolveReturnOrigin(requestedOrigin: string): string {
  const allowed = (process.env.ALLOWED_APP_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowed.includes(requestedOrigin)) {
    return requestedOrigin;
  }
  return allowed[0] ?? requestedOrigin;
}
