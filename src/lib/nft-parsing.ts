// Client-safe NFTokenID parsing. Mirrors nft-utils.ts but without the
// "server-only" guard so it can be imported from client components.
//
// Imports `encodeAccountID` directly from `ripple-address-codec` (~5 KB)
// rather than the full `xrpl` package (200+ KB w/ binary-codec, websocket
// client, signing, etc.) — the only thing nft-parsing needs is the
// 20-byte AccountID → classic 'r...' address transform.
import { encodeAccountID } from "ripple-address-codec";

export interface ParsedNFTokenID {
  flags: number;
  transfer_fee: number;
  issuer: string;
  nft_taxon: number;
  nft_serial: number;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function parseNFTokenID(nftId: string): ParsedNFTokenID | null {
  if (!/^[A-Fa-f0-9]{64}$/.test(nftId)) return null;
  try {
    const flags = parseInt(nftId.slice(0, 4), 16);
    const transferFee = parseInt(nftId.slice(4, 8), 16);
    const issuer = encodeAccountID(hexToBytes(nftId.slice(8, 48)));
    const scrambledTaxon = parseInt(nftId.slice(48, 56), 16) >>> 0;
    const serial = parseInt(nftId.slice(56, 64), 16) >>> 0;

    // Descramble: taxon = scrambled XOR ((384160001 * serial + 2459) & 0xFFFFFFFF).
    // BigInt avoids float precision loss at high serial numbers.
    const scramble = Number(
      (BigInt(384160001) * BigInt(serial) + 2459n) & 0xffffffffn,
    );
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
