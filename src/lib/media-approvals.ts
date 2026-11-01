/**
 * NFT media hosts the visitor allowed, per NFT. In memory only, so a
 * reload asks again. Which hosts need asking: `hostToApprove`.
 */

import { hostToApprove } from "./nft-media";

const approved = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const key = (nftId: string, host: string) => `${nftId} ${host}`;

export function isMediaApproved(nftId: string, host: string): boolean {
  return approved.has(key(nftId, host));
}

/** Allow `host` for this NFT's metadata and image. */
export function approveMedia(nftId: string, host: string): void {
  if (approved.has(key(nftId, host))) return;
  approved.add(key(nftId, host));
  version++;
  for (const fn of listeners) fn();
}

export function subscribeApprovals(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getApprovalsVersion = (): number => version;

/** The host to ask about before loading `ref` for `nftId`, or null
 *  when it may load now. */
export function pendingHost(nftId: string, ref: string | null | undefined): string | null {
  const host = hostToApprove(ref);
  return host && !isMediaApproved(nftId, host) ? host : null;
}
