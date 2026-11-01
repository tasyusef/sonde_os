import { Link } from "react-router";
import Facts, { Fact } from "@/components/shared/Facts";
import Section from "@/components/shared/Section";
import { useLiveData } from "@/hooks/useLiveData";
import { useXrpPrice } from "@/hooks/useXrpPrice";
import { formatVolume } from "@/lib/format";

function stateText(state: string): string {
  switch (state) {
    case "full":
    case "proposing":
    case "validating":
    case "validated":
      return "text-success";
    case "connected":
    case "syncing":
    case "tracking":
      return "text-warning";
    default:
      return "text-error";
  }
}

function loadText(factor: number): string {
  if (factor <= 1) return "text-success";
  if (factor <= 5) return "text-warning";
  return "text-error";
}

function formatLoadFactor(factor: number): string {
  return `${Number.isInteger(factor) ? factor : parseFloat(factor.toFixed(2))}x`;
}

/** Whole XRP in billions, from a drops string. */
function billionsFromDrops(drops: string): number {
  try {
    return Number(BigInt(drops) / 1_000_000n) / 1_000_000_000;
  } catch {
    return 0;
  }
}

const dash = <span className="text-muted">—</span>;

/** The network page's rail: XRP as an asset, then the state of the
 *  server the relay reads from. Both come from the relay snapshot. */
export default function NetworkFacts() {
  const { stats, health, connected } = useLiveData();
  const price = useXrpPrice();
  const waiting = connected ? null : "Connecting to the live feed…";

  // The relay sends 0 for figures no market API has answered yet.
  const circulating = price?.circulatingSupply ? price.circulatingSupply / 1_000_000_000 : null;
  const total = stats ? billionsFromDrops(stats.totalCoins) : 0;

  return (
    <>
      <Section title="Market" status={price ? null : (waiting ?? "Waiting for the price…")}>
        {price && (
          <Facts>
            <Fact label="Market cap">{price.marketCap ? formatVolume(price.marketCap) : dash}</Fact>
            <Fact label="24h volume">{price.volume24h ? formatVolume(price.volume24h) : dash}</Fact>
            <Fact label="Circulating">
              {circulating !== null ? <span className="tabular-nums">{circulating.toFixed(2)}B XRP</span> : dash}
              {circulating !== null && total > 0 && (
                <span className="block text-tag text-muted">of {total.toFixed(2)}B total</span>
              )}
            </Fact>
          </Facts>
        )}
      </Section>

      <Section title="Server" status={health ? null : (waiting ?? "Waiting for server health…")}>
        {health && (
          <Facts>
            <Fact label="State">
              <span className={stateText(health.serverState)}>{health.serverState}</span>
            </Fact>
            <Fact label="Validated">
              <Link to={`/ledger/${health.validatedSeq}`} className="link tabular-nums">
                {health.validatedSeq.toLocaleString()}
              </Link>
            </Fact>
            {stats && (
              <Fact label="Last ledger">
                {/* Ledgers close about every 4 seconds. */}
                <span className="tabular-nums">~{Math.round(stats.txCount / 4)} TPS</span>
                <span className="block text-tag text-muted">{stats.txCount.toLocaleString()} txns</span>
              </Fact>
            )}
            <Fact label="Load">
              <span className={`tabular-nums ${loadText(health.loadFactor)}`}>
                {formatLoadFactor(health.loadFactor)}
              </span>
            </Fact>
            <Fact label="Quorum">
              <span className="tabular-nums">{health.quorum}</span>
            </Fact>
            <Fact label="Ledger range">{health.completeLedgers}</Fact>
            <Fact label="Build">{health.buildVersion}</Fact>
          </Facts>
        )}
      </Section>
    </>
  );
}
