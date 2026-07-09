import UniversalProvider from "@walletconnect/universal-provider";

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const XRPL_CHAIN_ID = "xrpl:0";

/**
 * Hex-encode a UTF-8 string (browser-safe).
 */
function toHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Full Joey Wallet auth flow — no SDK React wrapper.
 *
 * 1. Init UniversalProvider
 * 2. Connect (produces QR URI)
 * 3. Wait for session (user scans + approves)
 * 4. Challenge-response signing
 * 5. Server verification → JWT session
 *
 * @param onUri  Callback with the WC URI + Joey deeplink for QR display
 * @returns The authenticated XRPL address
 */
export async function connectJoeyWallet(
  onUri: (uri: string, deeplink: string) => void,
): Promise<string> {
  // 1. Init provider fresh each time
  const provider = await UniversalProvider.init({
    projectId: PROJECT_ID,
    metadata: {
      name: "Sonde",
      description: "XRPL block explorer and portfolio tracker",
      url: typeof window !== "undefined" ? window.location.origin : "https://sondelab.com",
      icons: ["https://sondelab.com/icon.png"],
    },
  });

  // 2. Start connection — this triggers the "display_uri" event
  const sessionPromise = provider.connect({
    namespaces: {
      xrpl: {
        chains: [XRPL_CHAIN_ID],
        methods: ["xrpl_signTransaction"],
        events: ["chainChanged", "accountsChanged"],
      },
    },
  });

  // 3. Listen for the URI to show QR code
  provider.on("display_uri", (uri: string) => {
    const deeplink = `joey://settings/wc?uri=${encodeURIComponent(uri)}`;
    onUri(uri, deeplink);
  });

  // 4. Wait for session (resolves when user approves in Joey)
  const session = await sessionPromise;

  // 5. Extract address from session
  const xrplAccounts = session?.namespaces?.xrpl?.accounts ?? [];
  if (!xrplAccounts.length) {
    await provider.disconnect().catch(() => {});
    throw new Error("No XRPL accounts in session");
  }

  // Format: "xrpl:0:rAddress"
  const raw = xrplAccounts[0];
  const address = raw.split(":").pop()!;

  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,33}$/.test(address)) {
    await provider.disconnect().catch(() => {});
    throw new Error("Invalid XRPL address from wallet");
  }

  // 6. Challenge-response: fetch nonce → sign → verify
  const challengeRes = await fetch("/api/auth/joey/challenge");
  if (!challengeRes.ok) throw new Error("Failed to get challenge nonce");
  const { nonce } = (await challengeRes.json()) as { nonce: string };

  const tx_json = {
    TransactionType: "AccountSet",
    Account: address,
    Fee: "0",
    Sequence: 0,
    Memos: [
      {
        Memo: {
          MemoData: toHex(nonce),
          MemoType: toHex("auth/challenge"),
        },
      },
    ],
  };

  // 7. Sign via WC — use the session topic + chain ID
  const signResult = (await provider.request({
    method: "xrpl_signTransaction",
    params: { tx_json, submit: false, autofill: true },
  }, XRPL_CHAIN_ID)) as { tx_json?: Record<string, unknown>; tx_blob?: string };

  // 8. Encode to tx_blob
  //    Most wallets return tx_blob directly. The fallback path encodes
  //    tx_json ourselves — lazy-loaded so the binary codec (~50 KB) only
  //    ships to users who actually authenticate, not every page visitor.
  let txBlob = signResult.tx_blob;
  if (!txBlob && signResult.tx_json) {
    const forEncoding = { ...signResult.tx_json };
    delete forEncoding.hash;
    const { encode } = await import("ripple-binary-codec");
    txBlob = encode(forEncoding);
  }
  if (!txBlob) throw new Error("No signed transaction returned");

  // 9. Verify + create session
  const authRes = await fetch("/api/auth/joey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx_blob: txBlob }),
  });

  if (!authRes.ok) {
    const body = await authRes.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? "Signature verification failed",
    );
  }

  // 10. Cleanup WC session (auth is cookie-based now)
  await provider.disconnect().catch(() => {});

  return address;
}
