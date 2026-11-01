import { useSyncExternalStore } from "react";
import {
  approveMedia,
  getApprovalsVersion,
  pendingHost,
  subscribeApprovals,
} from "@/lib/media-approvals";

/** Changes whenever the visitor approves a media host. */
export function useApprovalsVersion(): number {
  return useSyncExternalStore(subscribeApprovals, getApprovalsVersion, () => 0);
}

/**
 * Whether `ref` (an NFT's metadata URI or image) may load for `nftId`.
 * `askHost` is the host to ask about first, or null; `approve` allows it
 * for this NFT until the page reloads.
 */
export function useMediaApproval(nftId: string, ref: string | null | undefined) {
  useApprovalsVersion();
  const askHost = pendingHost(nftId, ref);
  return {
    askHost,
    approve: () => {
      if (askHost) approveMedia(nftId, askHost);
    },
  };
}
