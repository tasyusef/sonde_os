import LedgerDetails from "@/components/ledger/LedgerDetails";
import LedgerHero from "@/components/ledger/LedgerHero";
import LedgerSkeleton from "@/components/ledger/LedgerSkeleton";
import LedgerTransactionList from "@/components/ledger/LedgerTransactionList";
import PageAlert, { UNREACHABLE_MESSAGE } from "@/components/shared/PageAlert";
import PageTitle from "@/components/shared/PageTitle";
import StageRail from "@/components/shared/StageRail";
import { useLedger } from "@/hooks/useLedger";
import { formatInteger } from "@/lib/format";

/** Ledger page body: loads the expanded ledger over the browser socket.
 *  Laid out like the other detail pages: the ledger on the stage, its
 *  facts in the rail, its transactions across the full width. */
export default function LedgerView({ param }: { param: string }) {
  const { ledger, transactions, valid, notFound, failed, unreachable, retry } = useLedger(param);
  const detail = `Ledger: ${param}`;

  if (!valid) return <PageAlert message="Invalid ledger index or hash" detail={detail} />;
  if (notFound) return <PageAlert message="Ledger not found" detail={detail} />;
  if (unreachable) return <PageAlert message={UNREACHABLE_MESSAGE} detail={detail} onRetry={retry} />;
  if (failed) {
    return (
      <PageAlert
        message="Couldn't load this ledger. The XRPL nodes didn't answer."
        detail={detail}
        onRetry={retry}
      />
    );
  }
  if (!ledger) return <LedgerSkeleton />;

  return (
    <>
      <PageTitle>{`Ledger #${formatInteger(ledger.ledger_index)} — XRPL | Sonde`}</PageTitle>
      <StageRail
        stage={<LedgerHero ledger={ledger} txCount={transactions.length} />}
        rail={<LedgerDetails ledger={ledger} />}
      />
      <LedgerTransactionList className="mt-16" transactions={transactions} />
    </>
  );
}
