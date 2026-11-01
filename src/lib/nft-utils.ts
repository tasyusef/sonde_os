import { encodeAccountID } from "ripple-address-codec";
import type { NFTInfo } from "@/types/nft";
import { hexToBytes } from "./hex";

interface ParsedNFTokenID {
  flags: number;
  transfer_fee: number;
  issuer: string;
  nft_taxon: number;
  nft_serial: number;
}

export function parseNFTokenID(nftId: string): ParsedNFTokenID | null {
  if (!/^[A-Fa-f0-9]{64}$/.test(nftId)) return null;
  try {
    const flags = parseInt(nftId.slice(0, 4), 16);
    const transferFee = parseInt(nftId.slice(4, 8), 16);
    const issuerBytes = hexToBytes(nftId.slice(8, 48));
    const issuer = encodeAccountID(issuerBytes);
    const scrambledTaxon = parseInt(nftId.slice(48, 56), 16) >>> 0;
    const serial = parseInt(nftId.slice(56, 64), 16) >>> 0;

    // Descramble taxon: taxon = scrambled XOR ((384160001 * serial + 2459) & 0xFFFFFFFF)
    // Use BigInt to avoid float precision loss for high serial numbers (> MAX_SAFE_INTEGER risk)
    const scramble = Number((BigInt(384160001) * BigInt(serial) + 2459n) & 0xffffffffn);
    const taxon = (scrambledTaxon ^ scramble) >>> 0;

    return {
      flags,
      transfer_fee: transferFee,
      issuer,
      nft_taxon: taxon,
      nft_serial: serial,
    };
  } catch {
    return null;
  }
}

/** What the NFTokenID alone says about an NFT, for when `nft_info`
 *  (Clio) can't be reached. Owner, URI and burn state are unknown. */
export function nftInfoFromId(nftId: string): NFTInfo | null {
  const parsed = parseNFTokenID(nftId);
  if (!parsed) return null;
  return { nft_id: nftId.toUpperCase(), owner: "", is_burned: false, uri: null, ...parsed };
}
