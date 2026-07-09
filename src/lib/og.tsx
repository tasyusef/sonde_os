import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/* ── Brand colors ─────────────────────────────────────────────── */
const BRAND = "#E8856C";
const BG = "#0B0D10";              // matches in-app --color-black
const SUBTLE_GRID = "rgba(255,255,255,0.05)";
const WHITE = "#FFFFFF";
const SECONDARY = "#9CA3AF";       // matches in-app --color-secondary
const MUTED = "#7B8291";           // matches in-app --color-muted


/* ── SVG path data (from SondeLogo) ──────────────────────────── */
export const MARK_PATH =
  "M170.74,2.37C77.61.64,1.77,76.48,3.5,169.61c1.63,87.77,73.24,159.39,161.01,161.01,93.13,1.73,168.97-74.12,167.24-167.24C330.13,75.61,258.51,3.99,170.74,2.37ZM171.71,206.16c-25.18,2.52-46.26-18.56-43.74-43.74,1.86-18.64,16.94-33.72,35.58-35.58,25.18-2.52,46.26,18.56,43.74,43.74-1.86,18.64-16.94,33.72-35.58,35.58ZM188.73,282.01v-33.36c0-1.68,1.12-3.12,2.73-3.61,34.46-10.44,59.34-42.92,58.21-81.04-1.26-42.82-36.03-77.91-78.84-79.53-46.79-1.78-85.28,35.62-85.28,82.02,0,37.04,24.54,68.34,58.25,78.55,1.6.49,2.72,1.93,2.72,3.61v33.36c0,2.41-2.23,4.17-4.59,3.67-57.47-12.38-100.03-65.34-95.99-127.31,3.91-59.96,51.81-108.63,111.7-113.42,71.72-5.73,131.92,51.01,131.92,121.55,0,58.43-41.32,107.36-96.27,119.19-2.35.5-4.57-1.27-4.57-3.67Z";

export const WORDMARK_PATHS = [
  "M466.14,201.28c1.9,0,3.46,1.43,3.72,3.32,1.83,13.32,12.93,21.53,31.32,21.53,20.23,0,31.23-8.16,31.23-20.94,0-8.87-4.61-15.26-20.23-18.81l-31.59-7.45c-31.59-7.1-46.85-22-46.85-50.04,0-34.43,29.1-55.01,69.56-55.01,37.81,0,63.86,20.93,66.2,52.74.16,2.18-1.57,4.04-3.76,4.04h-33.77c-1.92,0-3.48-1.45-3.72-3.35-1.68-12.98-11.33-21.14-26.72-21.14-17.04,0-26.97,7.81-26.97,20.94,0,9.94,7.81,16.33,22.71,19.87l31.59,7.45c29.46,6.74,44.36,20.23,44.36,47.2,0,35.49-30.17,57.49-73.47,57.49s-69.13-21.62-71.21-53.83c-.14-2.17,1.59-4.01,3.76-4.01h33.83Z",
  "M689.63,74.22c54.3,0,93.69,37.62,93.69,92.27s-39.39,92.27-93.69,92.27-93.69-37.62-93.69-92.27,39.39-92.27,93.69-92.27ZM689.63,220.09c29.81,0,50.4-21.65,50.4-53.59s-20.58-53.59-50.4-53.59-50.4,21.65-50.4,53.59,20.58,53.59,50.4,53.59Z",
  "M817.75,250.76V82.94c0-2.07,1.68-3.75,3.75-3.75h33.14c1.85,0,3.42,1.35,3.71,3.17l1.68,10.72c.49,3.13,4.41,4.29,6.5,1.91,11.8-13.48,30.46-21.13,50.95-21.13,44.01,0,66.72,27.33,66.72,72.75v104.14c0,2.07-1.68,3.75-3.75,3.75h-35.79c-2.07,0-3.75-1.68-3.75-3.75v-93.85c0-29.46-14.55-43.65-36.91-43.65-26.62,0-42.94,18.46-42.94,46.85v90.65c0,2.07-1.68,3.75-3.75,3.75h-35.79c-2.07,0-3.75-1.68-3.75-3.75Z",
  "M1016.48,167.56c0-54.65,31.94-93.69,84.82-93.69,20.38,0,38.8,7.13,50.74,19.55,2.31,2.4,6.39.67,6.39-2.66V18.61c0-2.07,1.68-3.75,3.75-3.75h35.44c2.07,0,3.75,1.68,3.75,3.75v232.15c0,2.07-1.68,3.75-3.75,3.75h-32.61c-1.92,0-3.53-1.45-3.73-3.36l-1.4-13.51c-.34-3.31-4.55-4.59-6.62-1.99-11.97,14.99-31.79,23.47-54.44,23.47-50.75,0-82.34-37.26-82.34-91.56ZM1158.09,166.14c0-31.59-19.52-53.59-49.69-53.59s-48.62,22.36-48.62,53.59,18.46,53.24,48.62,53.24,49.69-21.65,49.69-53.24Z",
  "M1236.16,166.85c0-55.01,35.85-92.98,87.31-92.98s85.89,35.14,85.89,89.79v9.39c0,2.07-1.67,3.75-3.74,3.75l-124.03.33c-2.29,0-4.05,2.06-3.71,4.32,4.23,28.02,20.34,42.18,47.72,42.18,22.63,0,37.87-8.36,43.57-23.54.54-1.44,1.94-2.37,3.48-2.37h32.72c2.45,0,4.26,2.32,3.65,4.69-9.07,35.51-40.24,56.71-84.12,56.71-52.17,0-88.73-37.97-88.73-92.27ZM1282.95,149.46h79.54c2.18,0,3.93-1.87,3.76-4.04-1.77-21.86-18-36.06-42.43-36.06s-39.27,12.24-44.54,35.54c-.53,2.34,1.28,4.57,3.67,4.57Z",
];

/* ── Font loader (cached per cold start) ─────────────────────── */
let fontsPromise: Promise<{ name: string; data: Buffer; weight: number; style: string }[]> | null =
  null;

const fontsDir = join(process.cwd(), "src", "assets", "fonts");

function getFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(join(fontsDir, "Satoshi-Bold.woff")),
      readFile(join(fontsDir, "IBMPlexMono-Medium.woff")),
    ]).then(([satoshi, mono]) => [
      { name: "Satoshi", data: satoshi, weight: 700, style: "normal" },
      { name: "IBM Plex Mono", data: mono, weight: 500, style: "normal" },
    ]).catch((err) => {
      fontsPromise = null;
      throw err;
    });
  }
  return fontsPromise;
}

/* ── Constellation loader ────────────────────────────────────────
 * Brand-asset network graph backdrop, loaded from
 * src/assets/og/constellation.svg (mirror of the press-kit asset at
 * brand/sonde_press_kit/sonde-network-background.svg). Read once at
 * cold start and cached as a base64 data URI so the OG renderer can
 * embed it via <img> without any network call.
 *
 * Source SVG viewBox is 1200×800 — we render at the full canvas width
 * and let it crop on the bottom edge, which positions the graph's
 * dense cluster slightly below center where it doesn't compete with
 * the title.
 */
const constellationDir = join(process.cwd(), "src", "assets", "og");
let constellationPromise: Promise<string> | null = null;

function getConstellationDataUri() {
  if (!constellationPromise) {
    constellationPromise = readFile(
      join(constellationDir, "constellation.svg"),
    )
      .then((buf) => `data:image/svg+xml;base64,${buf.toString("base64")}`)
      .catch((err) => {
        constellationPromise = null;
        throw err;
      });
  }
  return constellationPromise;
}

/* ── Background: dark + brand constellation + grid + vignette ─── */
function BackgroundLayer({ constellationSrc }: { constellationSrc: string }) {
  const W = 1200;
  const H = 630;
  const GRID = 60;
  const cols = Math.ceil(W / GRID) + 1;
  const rows = Math.ceil(H / GRID) + 1;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex" }}>
      {/* Brand constellation — full width, let bottom crop naturally */}
      {/* eslint-disable-next-line @next/next/no-img-element -- og runtime */}
      <img
        src={constellationSrc}
        alt=""
        width={W}
        height={800}
        style={{ position: "absolute", inset: 0 }}
      />

      {/* Subtle grid texture overlay */}
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "absolute", inset: 0 }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={i * GRID}
            x2={W}
            y2={i * GRID}
            stroke={SUBTLE_GRID}
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: cols }, (_, i) => (
          <line
            key={`v${i}`}
            x1={i * GRID}
            y1={0}
            x2={i * GRID}
            y2={H}
            stroke={SUBTLE_GRID}
            strokeWidth={1}
          />
        ))}
      </svg>

      {/* Radial vignette — fades edges, keeps title area clean */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background:
            "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </div>
  );
}

/* ── Sonde Mark inline SVG ───────────────────────────────────── */
function SondeMark({ size = 40, color = BRAND }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 331.75 332.99" width={size} height={size} fill={color}>
      <path d={MARK_PATH} />
    </svg>
  );
}

/* ── Sonde Wordmark inline SVG ───────────────────────────────── */
function SondeWordmarkSVG({ height = 22, color = BRAND }: { height?: number; color?: string }) {
  return (
    <svg viewBox="434 12 980 258" height={height} fill={color}>
      {WORDMARK_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/* ── Shared OG layout ────────────────────────────────────────── */
export interface OGLayoutProps {
  title: string;
  accent?: string;
  subtitle?: string;
  /** Bottom-left caption after "/", e.g. "EXPLORER", "ACCOUNT", "PRO". Defaults to "EXPLORER". */
  label?: string;
  /** Switch the title to IBM Plex Mono — for hashes, addresses, ledger indexes. */
  mono?: boolean;
  /** Render the brand logo lockup (mark + wordmark) in place of the title text.
   *  Used by the homepage OG so the brand is the headline rather than the page name. */
  titleAsLogo?: boolean;
}

/**
 * Dark OG card with the brand network-graph constellation backdrop:
 *   - Slate-black background + brand SVG constellation + subtle grid + vignette
 *   - Title + optional accent in large white/brand type — OR the brand
 *     logo lockup itself when `titleAsLogo` is set
 *   - Optional subtitle in muted grey
 *   - Bottom-left "/ {LABEL}" caption (no inline lockup; the constellation
 *     carries the brand identity)
 *   - Bottom-right "sondelab.com" in muted grey
 */
export function OGLayout({
  title,
  accent,
  subtitle,
  label,
  mono = false,
  titleAsLogo = false,
  constellationSrc,
}: OGLayoutProps & { constellationSrc: string }) {
  return (
    <div
      style={{
        width: "1200px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        fontFamily: "Satoshi",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Constellation + grid + vignette */}
      <BackgroundLayer constellationSrc={constellationSrc} />

      {/* Content layer */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "88px 96px",
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "28px",
            maxWidth: "1000px",
          }}
        >
          {/* Title — either the brand logo lockup (homepage) or large
              type with optional accent on the same line. */}
          {titleAsLogo ? (
            <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
              <SondeMark size={140} color={BRAND} />
              <SondeWordmarkSVG height={104} color={WHITE} />
            </div>
          ) : (
            <div
              style={{
                fontSize: mono ? "78px" : "124px",
                fontWeight: 700,
                color: WHITE,
                lineHeight: 1.02,
                letterSpacing: mono ? "0px" : "-3px",
                fontFamily: mono ? "IBM Plex Mono" : "Satoshi",
                wordBreak: "break-all",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
              }}
            >
              {title}
              {accent && (
                <span
                  style={{
                    color: BRAND,
                    marginLeft: "24px",
                    fontWeight: 500,
                  }}
                >
                  {accent}
                </span>
              )}
            </div>
          )}

          {subtitle && (
            <div
              style={{
                fontSize: "36px",
                color: SECONDARY,
                fontFamily: "Satoshi",
                fontWeight: 400,
                lineHeight: 1.35,
                maxWidth: "1000px",
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {/* Bottom-left page label — just "/ EXPLORER" (or whatever the
          page provides). Brand identity is carried by the constellation
          and (for the homepage) the title lockup, so no need to repeat. */}
      <div
        style={{
          position: "absolute",
          bottom: "48px",
          left: "96px",
          display: "flex",
          fontFamily: "IBM Plex Mono",
          fontSize: "22px",
          fontWeight: 500,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: "2px",
        }}
      >
        / {label ?? "Explorer"}
      </div>

      {/* Bottom-right URL */}
      <div
        style={{
          position: "absolute",
          bottom: "48px",
          right: "96px",
          display: "flex",
          fontFamily: "IBM Plex Mono",
          fontSize: "22px",
          fontWeight: 500,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: "2px",
        }}
      >
        sondelab.com
      </div>
    </div>
  );
}

/* ── Helper: create OG ImageResponse with fonts + constellation ── */
/**
 * Builds an OG ImageResponse from layout props. Loads fonts and the
 * brand constellation backdrop in parallel; both are cached for the
 * process lifetime so subsequent renders only pay font init once.
 *
 * Callers pass layout props directly (no JSX) — the wrapper handles
 * mounting OGLayout with the loaded constellation.
 */
export async function createOG(props: OGLayoutProps) {
  const [fonts, constellationSrc] = await Promise.all([
    getFonts(),
    getConstellationDataUri(),
  ]);
  return new ImageResponse(
    <OGLayout {...props} constellationSrc={constellationSrc} />,
    {
      width: 1200,
      height: 630,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fonts: fonts as any,
    },
  );
}
