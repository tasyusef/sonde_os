import { randomBytes } from "crypto";
import { LRUCache } from "@/lib/cache";

const nonceCache = new LRUCache<true>(500, 5 * 60 * 1000);

export function createChallenge(): string {
  const nonce = randomBytes(16).toString("hex");
  nonceCache.set(nonce, true);
  return nonce;
}

export function consumeChallenge(nonce: string): boolean {
  if (!nonceCache.get(nonce)) return false;
  nonceCache.delete(nonce);
  return true;
}
