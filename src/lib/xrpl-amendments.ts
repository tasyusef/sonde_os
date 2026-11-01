/**
 * XRPL amendment registry: name, ID and mainnet activation for each
 * amendment we know about.
 *
 * The node's `feature` response doesn't always carry names, and the
 * ledger never records when an amendment activated, so
 * `amendments.ts` fills both from here.
 *
 * Amendment IDs sourced from rippled's `feature` JSON-RPC method against
 * `s1.ripple.com`. Activation ledgers populated via binary search on the
 * on-chain Amendments singleton. Last refreshed: 2026-04-27 against
 * validated ledger 103,854,829.
 *
 * To refresh:
 *   pnpm exec tsx scripts/lookup-amendment-activations.ts --update
 *   # auto-patches activationLedger and activationDate for every entry
 */

export interface AmendmentEntry {
  /** 64-char uppercase hex amendment ID (the rippled `Amendment` field). */
  id: string;
  /** Mainnet activation ledger index. `null` if unknown/not enabled. */
  activationLedger: number | null;
  /** ISO date of mainnet activation, for human reference. `null` if unknown. */
  activationDate: string | null;
  /** Whether the amendment is currently enabled on mainnet. */
  enabled: boolean;
  /** Short human description of what this amendment changed. */
  notes?: string;
}

/**
 * Known amendments, keyed by name. `activationLedger: null` means not yet
 * enabled on mainnet (testnet only or still in voting).
 */
export const AMENDMENT_ACTIVATION: Record<string, AmendmentEntry> = {
  /* ── NFT family ────────────────────────────────────────────────── */

  NonFungibleTokensV1_1: {
    id: "32A122F1352A4C7B3A6D790362CC34749C5E57FCE896377BFDC6CCD14F6CD627",
    activationLedger: 75443457,
    activationDate: "2022-10-31",
    enabled: true,
    notes: "Enables NFTokenMint, NFTokenBurn, NFTokenAcceptOffer, NFTokenCreateOffer, NFTokenCancelOffer.",
  },
  NFTokenMintOffer: {
    id: "EE3CF852F0506782D05E65D49E5DCC3D16D50898CD1B646BAE274863401CC3CE",
    activationLedger: 94166785,
    activationDate: "2025-02-15",
    enabled: true,
    notes: "Lets NFTokenMint create a sell offer in the same tx.",
  },
  DynamicNFT: {
    id: "C1CE18F2A268E6A849C27B3DE485006771B4C01B2FCEC4F18356FE92ECD6BB74",
    activationLedger: 96724737,
    activationDate: "2025-06-11",
    enabled: true,
    notes: "Enables NFTokenModify (mutable URI/metadata).",
  },
  fixNonFungibleTokensV1_2: {
    id: "73761231F7F3D94EC3D8C63D91BDD0D89045C6F71B917D1925C01253515A6669",
    activationLedger: 81986305,
    activationDate: "2023-08-21",
    enabled: true,
    notes: "NFT bug fixes; not classifier-gating but tracked for completeness.",
  },
  fixEnforceNFTokenTrustline: {
    id: "763C37B352BE8C7A04E810F8E462644C45AFEAD624BF3894A08E5C917CF9FF39",
    activationLedger: 93814529,
    activationDate: "2025-01-30",
    enabled: true,
  },
  fixEnforceNFTokenTrustlineV2: {
    id: "B32752F7DCC41FB86534118FC4EEC8F56E7BD0A7DB60FD73F93F257233C08E3A",
    activationLedger: 98491905,
    activationDate: "2025-08-29",
    enabled: true,
  },
  fixNFTokenRemint: {
    id: "AE35ABDEFBDE520372B31C957020B34A7A4A9DC3115A69803A44016477C84D6E",
    activationLedger: 84206081,
    activationDate: "2023-11-27",
    enabled: true,
  },
  fixRemoveNFTokenAutoTrustLine: {
    id: "DF8B4536989BDACE3F934F29423848B9F1D76D09BE6A1FCFE7E7F06AA26ABEAD",
    activationLedger: 75348737,
    activationDate: "2022-10-27",
    enabled: true,
  },
  fixNFTokenPageLinks: {
    id: "C7981B764EC4439123A86CC7CCBA436E9B3FF73B3F10A0AE51882E404522FC41",
    activationLedger: 93814529,
    activationDate: "2025-01-30",
    enabled: true,
  },
  fixNFTokenReserve: {
    id: "03BDC0099C4E14163ADA272C1B6F6FABB448CC3E51F522F978041E4B57D9158C",
    activationLedger: 87259137,
    activationDate: "2024-04-12",
    enabled: true,
  },

  /* ── AMM family ────────────────────────────────────────────────── */

  AMM: {
    id: "8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455",
    activationLedger: 86795265,
    activationDate: "2024-03-22",
    enabled: true,
    notes: "Enables AMMCreate, AMMDeposit, AMMWithdraw, AMMVote, AMMBid, AMMDelete.",
  },
  AMMClawback: {
    id: "726F944886BCDF7433203787E93DD9AA87FAB74DFE3AF4785BA03BEFC97ADA1F",
    activationLedger: 93814273,
    activationDate: "2025-01-30",
    enabled: true,
    notes: "Enables AMMClawback tx type.",
  },
  fixAMMv1_1: {
    id: "35291ADD2D79EB6991343BDA0912269C817D0F094B02226C1C14AD2858962ED4",
    activationLedger: 90967553,
    activationDate: "2024-09-24",
    enabled: true,
  },
  fixAMMv1_2: {
    id: "1E7ED950F2F13C4F8E2A54103B74D57D5D298FFDBD005936164EE9E6484C438C",
    activationLedger: 93815809,
    activationDate: "2025-01-30",
    enabled: true,
  },
  fixAMMv1_3: {
    id: "7CA70A7674A26FA517412858659EBC7EDEEF7D2D608824464E6FDEFD06854E14",
    activationLedger: 98491905,
    activationDate: "2025-08-29",
    enabled: true,
  },
  fixAMMOverflowOffer: {
    id: "12523DF04B553A0B1AD74F42DDB741DE8DC06A03FC089A0EF197E2A87F1D8107",
    activationLedger: 87232257,
    activationDate: "2024-04-11",
    enabled: true,
  },
  fixAMMClawbackRounding: {
    id: "5E9586DB3D765B4C5794658FB6BB385071E9838DF4016027E6E26820C8526724",
    activationLedger: 101852417,
    activationDate: "2026-01-27",
    enabled: true,
  },
  fixFrozenLPTokenTransfer: {
    id: "83FD6594FF83C1D105BD2B41D7E242D86ECB4A8220BD9AF4DA35CB0F69E39B2A",
    activationLedger: 96126977,
    activationDate: "2025-05-15",
    enabled: true,
  },

  /* ── Token / IOU features ─────────────────────────────────────── */

  Clawback: {
    id: "56B241D7A43D40354D02A9DC4C8DF5C7A1F930D92A9035C4E12291B3CA3E1C2B",
    activationLedger: 85829633,
    activationDate: "2024-02-08",
    enabled: true,
    notes: "Enables Clawback tx for IOU issuers (separate from AMMClawback).",
  },
  MPTokensV1: {
    id: "950AE2EA4654E47F04AA8739C0B214E242097E802FD372D24047A89AB1F5EC38",
    activationLedger: 99226369,
    activationDate: "2025-10-01",
    enabled: true,
    notes: "Multi-Purpose Tokens (MPTokenIssuanceCreate/Set/Destroy, MPTokenAuthorize).",
  },
  fixMPTDeliveredAmount: {
    id: "AB8D932A5F338903FE5BCBD80B611FFED70839ABA3170E9CE01D947C0EDEDCF2",
    activationLedger: 101852417,
    activationDate: "2026-01-27",
    enabled: true,
  },
  DeepFreeze: {
    id: "DAF3A6EB04FA5DC51E8E4F23E9B7022B693EFA636F23F22664746C77B5786B23",
    activationLedger: 95893505,
    activationDate: "2025-05-04",
    enabled: true,
  },

  /* ── Other tx-type features (DID, oracles, escrows, etc.) ─────── */

  DID: {
    id: "DB432C3A09D9D5DFC7859F39AE5FF767ABC59AED0A9FB441E83B814D8946C109",
    activationLedger: 91778561,
    activationDate: "2024-10-30",
    enabled: true,
    notes: "DIDSet / DIDDelete tx types.",
  },
  fixEmptyDID: {
    id: "755C971C29971C9F20C6F080F2ED96F87884E40AD19554A5EBECDCEC8A1F77FE",
    activationLedger: 91038721,
    activationDate: "2024-09-27",
    enabled: true,
  },
  PriceOracle: {
    id: "96FD2F293A519AE1DB6F8BED23E4AD9119342DA7CB6BAFD00953D16C54205D8B",
    activationLedger: 91831297,
    activationDate: "2024-11-02",
    enabled: true,
    notes: "OracleSet / OracleDelete tx types.",
  },
  Credentials: {
    id: "1CB67D082CF7D9102412D34258CEDB400E659352D3B207348889297A6D90F5EF",
    activationLedger: 98615297,
    activationDate: "2025-09-04",
    enabled: true,
    notes: "CredentialCreate / CredentialAccept / CredentialDelete.",
  },
  PermissionedDomains: {
    id: "A730EB18A9D4BB52502C898589558B4CCEB4BE10044500EE5581137A2E80E849",
    activationLedger: 102017793,
    activationDate: "2026-02-04",
    enabled: true,
  },
  PermissionedDEX: {
    id: "677E401A423E3708363A36BA8B3A7D019D21AC5ABD00387BDBEA6BDE4C91247E",
    activationLedger: 102328065,
    activationDate: "2026-02-18",
    enabled: true,
  },
  PermissionDelegation: {
    id: "AE6AB9028EEB7299EBB03C7CBCC3F2A4F5FBE00EA28B8223AA3118A0B436C1C5",
    activationLedger: null,
    activationDate: null,
    enabled: false, // not yet on mainnet as of 2026-04
  },
  TokenEscrow: {
    id: "138B968F25822EFBF54C00F97031221C47B1EAB8321D93C7C2AEAF85F04EC5DF",
    activationLedger: 102204929,
    activationDate: "2026-02-12",
    enabled: true,
    notes: "Lets escrows hold IOUs, not just XRP.",
  },
  fixTokenEscrowV1: {
    id: "32B8614321F7E070419115ABEAB1742EA20F3E3AF34432B5E2F474F8083260DC",
    activationLedger: 101852417,
    activationDate: "2026-01-27",
    enabled: true,
  },
  XChainBridge: {
    id: "C98D98EE9616ACD36E81FDEB8D41D349BF5F1B41DD64A0ABC1FE9AA5EA267E9C",
    activationLedger: null,
    activationDate: null,
    enabled: false,
    notes: "Cross-chain bridge tx types — NOT enabled on mainnet as of 2026-04.",
  },
  Batch: {
    id: "894646DD5284E97DECFE6674A6D6152686791C4A95F8C132CCA9BAF9E5812FB6",
    activationLedger: null,
    activationDate: null,
    enabled: false,
  },
  SingleAssetVault: {
    id: "81BD2619B6B3C8625AC5D0BC01DE17F06C3F0AB95C7C87C93715B87A4FD240D8",
    activationLedger: null,
    activationDate: null,
    enabled: false,
  },
  LendingProtocol: {
    id: "565B90CA1AB2B9D42208ED10884188C64F9E19083DECB9634AAF06EB03299509",
    activationLedger: null,
    activationDate: null,
    enabled: false,
  },
};
