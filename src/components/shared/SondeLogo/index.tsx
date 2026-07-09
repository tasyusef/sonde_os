// Re-exports keep the import path stable (`@/components/shared/SondeLogo`)
// while letting each piece live in its own file. SondeMark is a pure
// server SVG; SondeWordmark is a client component for the staggered
// motion animation. Importing this index.tsx from a server tree only
// pulls a client boundary if the consumer touches SondeWordmark.

export { SondeMark } from "./SondeMark";
export { SondeWordmark } from "./SondeWordmark";
