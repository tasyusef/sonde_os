/**
 * Known XRPL addresses — exchanges, gateways, services, issuers.
 * Generated 2026-03-25 from the Bithomp API and the token_metadata
 * table by a seed script since removed (see git history); edit by hand.
 */

export interface KnownAddress {
  name: string;
  type: "exchange" | "gateway" | "service" | "issuer" | "foundation" | "dex";
}

const KNOWN_ADDRESSES: Record<string, KnownAddress> = {
  "rBEARGUAsyu7tUw53rufQzFdWmJHpJEqFW": { name: "BearXRPL", type: "issuer" },
  "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh": { name: "Binance", type: "exchange" },
  "rEy8TFcrAPvhpKrwyrscNYyqBGUkE9hKaJ": { name: "Binance", type: "exchange" },
  "rNxp4h8apvRis6mJf9Sh8C6iRxfrDWN7AV": { name: "Binance", type: "exchange" },
  "rLW9gnQo7BQhU6igk5keqYnH3TVrCxGRzm": { name: "Bitfinex", type: "exchange" },
  "rKontEGtDju5MCEJCwtrvTWQQqVAw5juXe": { name: "Bithomp validator", type: "service" },
  "rrpNnNLKrartuEqfJGpqyDwPj1AFPg9vn1": { name: "Bitstamp", type: "gateway" },
  "rGFuMiw48HdbnrUbkRYuitXTmfrDBNTCnX": { name: "Bitstamp", type: "gateway" },
  "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv": { name: "Bitstamp", type: "gateway" },
  "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B": { name: "Bitstamp", type: "gateway" },
  "rBitcoiNXev8VoVxV7pwoQx1sSfonVP9i3": { name: "BITx", type: "issuer" },
  "raKhUVtNw6B892bKtATUT3frX35oawfsey": { name: "Black Market Dawgs", type: "issuer" },
  "rNQEMJA4PsoSrZRn9J6RajAYhcDzzhf8ok": { name: "coincheck", type: "service" },
  "rU2mEJSLqBRkYLVTv55rFTgQajkLTnT6mA": { name: "coins.ph", type: "service" },
  "rRbiKwcueo6MchUpMFDce9XpDwHhRLPFo": { name: "CryptoLand", type: "issuer" },
  "r9Xzi4KsSF1Xtr8WHyBmUcvfP9FzTyG5wp": { name: "CryptoTradingFund", type: "issuer" },
  "rszenFJoDdiGjyezQc8pME9KWDQH43Tswh": { name: "Drop", type: "issuer" },
  "rHcFoo6a9qT5NHiVn1THQRhsEGcxtYCV4d": { name: "gate.io", type: "exchange" },
  "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq": { name: "GateHub Crypto", type: "gateway" },
  "ra9g3LAJm9xJu8Awe7oWzR6VXFB1mpFtSe": { name: "GateHub Crypto", type: "issuer" },
  "rcA8X3TVMST1n3CJeAdGk1RdRCHii7N2h": { name: "GateHub Crypto", type: "issuer" },
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh": { name: "Genesis account", type: "service" },
  "r4pXXQzJ8soYSX4QKeeW4BzRQS1PCtVYLJ": { name: "JoeLee", type: "issuer" },
  "rXmagwMmnFtVet3uL26Q2iwk287SRvVMJ": { name: "Magnetic", type: "issuer" },
  "rHWcuuZoFvDS6gNbmHSdpb7u1hZzxvCoMt": { name: "Paribu", type: "service" },
  "rDbWJ9C7uExThZYAwV8m6LsZ5YSX3sa6US": { name: "Ripple", type: "foundation" },
  "r3kmLJN5D28dHuH8vZNUZpMC43pEHpaocV": { name: "Ripple", type: "foundation" },
  "rJnZ4YHCUsHvQu7R6mZohevKJDHFzVD6Zr": { name: "rippleWallet18972352", type: "foundation" },
  "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz": { name: "Sologenic", type: "issuer" },
  "rJUQZf114RfshxthTNm7DXbCnrHR8uGPdK": { name: "Thezzy Terminal", type: "issuer" },
  "raQwCVAJVqjrVm1Nj5SFRcX8i22BhdC9WA": { name: "UPbit", type: "service" },
  "rfQNEfqLQc5L34rS92Xh5nVtk9NVHbv4Gj": { name: "XLOYALITY", type: "issuer" },
  "rXPMxBeefHGxx2K7g5qmmWq3gFsgawkoa": { name: "XPmarket", type: "issuer" },
  "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY": { name: "XRP Tip Bot", type: "service" },
};

/**
 * Get just the display name for a known address.
 */
export function getKnownName(address: string): string | null {
  return KNOWN_ADDRESSES[address]?.name ?? null;
}

/**
 * Detect account type from flags and settings.
 * Returns a human-readable label and style category.
 */
export interface AccountType {
  label: string;
  category: "amm" | "issuer" | "nft-issuer" | "regular";
}

export function getAccountType(flags: number, settings: {
  regularKey?: string;
  transferRate?: number;
  domain?: string;
  nfTokenMinter?: string;
}): AccountType {
  // AMM account (lsfAMM = 0x40000000)
  if ((flags & 0x40000000) !== 0) {
    return { label: "AMM Pool", category: "amm" };
  }

  // NFT issuer (has minted NFTs or has authorized minter)
  if (settings.nfTokenMinter) {
    return { label: "NFT Issuer", category: "nft-issuer" };
  }

  // Token issuer (has transferRate above 1:1 or defaultRipple enabled)
  // transferRate of 1000000000 means exactly 0% fee — not an issuer signal
  const hasDefaultRipple = (flags & 0x00800000) !== 0;
  if ((settings.transferRate && settings.transferRate > 1000000000) || hasDefaultRipple) {
    return { label: "Token Issuer", category: "issuer" };
  }

  return { label: "Account", category: "regular" };
}
