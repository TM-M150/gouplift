/**
 * 24 random bytes as URL-safe text (32 characters): unguessable, and short
 * enough for a link. For secrets that travel in an address, like the private
 * link in a receipt.
 */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
