import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { MARK_PATH, WORDMARK_PATHS } from "@/lib/og";

/* ── Brand colors ─────────────────────────────────────────────── */
const BG = "#0B0D10";
const TEXT = "#E5E7EB";
const MUTED = "#6B7280";
const BRAND = "#E8856C";

const W = 2160;
const H = 3840;

/* ── Font loader ─────────────────────────────────────────────── */
let fontsPromise: Promise<
  { name: string; data: Buffer; weight: number; style: string }[]
> | null = null;

const fontsDir = join(process.cwd(), "src", "assets", "fonts");

function getFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(join(fontsDir, "Satoshi-Bold.woff")),
      readFile(join(fontsDir, "IBMPlexMono-Medium.woff")),
    ]).then(([satoshi, mono]) => [
      { name: "Satoshi", data: satoshi, weight: 700, style: "normal" },
      { name: "IBM Plex Mono", data: mono, weight: 500, style: "normal" },
    ]);
  }
  return fontsPromise;
}

/* ── Grid overlay ────────────────────────────────────────────── */
function GridOverlay() {
  const GRID = 120;
  const cols = Math.ceil(W / GRID) + 1;
  const rows = Math.ceil(H / GRID) + 1;
  const LINE = "#3a3f4b";

  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex" }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "absolute", top: 0, left: 0, width: W, height: H }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={i * GRID}
            x2={W}
            y2={i * GRID}
            stroke={LINE}
            strokeWidth={1}
            opacity={0.25}
          />
        ))}
        {Array.from({ length: cols }, (_, i) => (
          <line
            key={`v${i}`}
            x1={i * GRID}
            y1={0}
            x2={i * GRID}
            y2={H}
            stroke={LINE}
            strokeWidth={1}
            opacity={0.25}
          />
        ))}
      </svg>
      {/* Fade grid toward bottom */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: W,
          height: H,
          display: "flex",
          background: `linear-gradient(to bottom, transparent 0%, ${BG} 75%)`,
        }}
      />
    </div>
  );
}

/* ── Sonde Mark ──────────────────────────────────────────────── */
function SondeMark({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 331.75 332.99" width={size} height={size} fill={BRAND}>
      <path d={MARK_PATH} />
    </svg>
  );
}

/* ── Sonde Wordmark ──────────────────────────────────────────── */
function SondeWordmarkSVG({ height = 22 }: { height?: number }) {
  return (
    <svg viewBox="434 12 980 258" height={height} fill={BRAND}>
      {WORDMARK_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/* ── Arrow icon ──────────────────────────────────────────────── */
function ArrowRight() {
  return (
    <svg
      width={40}
      height={40}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

/* ── Main layout ─────────────────────────────────────────────── */
function SocialImage() {
  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: BG,
        fontFamily: "Satoshi",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Grid overlay */}
      <GridOverlay />

      {/* Brand gradient — linear from bottom (above grid fade) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: W,
          height: H,
          display: "flex",
          background:
            "linear-gradient(to top, rgba(232, 133, 108, 0.15) 0%, transparent 45%)",
        }}
      />

      {/* Content layer */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0 160px",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "28px",
            marginBottom: "160px",
          }}
        >
          <SondeMark size={88} />
          <SondeWordmarkSVG height={56} />
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: "172px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: 1.05,
            letterSpacing: "-4px",
            textAlign: "center",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          Built for{" "}
          <span style={{ color: BRAND, marginLeft: "36px" }}>power users.</span>
        </div>

        {/* Feature pills */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "32px",
            marginTop: "72px",
            fontFamily: "Satoshi",
            fontSize: "34px",
            fontWeight: 700,
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "4px",
          }}
        >
          <span>Real-time streaming</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>7 Explorer views</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>Data-dense UI</span>
        </div>

        {/* CTA button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            marginTop: "96px",
            backgroundColor: BRAND,
            borderRadius: "28px",
            padding: "28px 56px",
            fontSize: "36px",
            fontWeight: 700,
            color: "white",
          }}
        >
          Start Exploring
          <ArrowRight />
        </div>
      </div>

      {/* URL at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: "120px",
          display: "flex",
          fontFamily: "Satoshi",
          fontSize: "40px",
          fontWeight: 700,
          color: MUTED,
          letterSpacing: "4px",
        }}
      >
        sondelab.com
      </div>
    </div>
  );
}

export async function GET() {
  const fonts = await getFonts();
  return new ImageResponse(<SocialImage />, {
    width: W,
    height: H,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fonts: fonts as any,
  });
}
