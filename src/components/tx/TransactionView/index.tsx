import PageAlert, { UNREACHABLE_MESSAGE } from "@/components/shared/PageAlert";
import PageTitle from "@/components/shared/PageTitle";
import TransactionDetail from "@/components/tx/TransactionDetail";
import TxSkeleton from "@/components/tx/TxSkeleton";
import { useTransaction } from "@/hooks/useTransaction";

/** Tx page body: loads the tx over the browser socket. */
export default function TransactionView({ hash }: { hash: string }) {
  const { tx, valid, notFound, failed, unreachable, retry } = useTransaction(hash);
  const short = `${hash.slice(0, 8)}...${hash.slice(-6)}`;

  if (!valid) return <PageAlert message="Invalid transaction hash format" detail={`Hash: ${hash}`} />;
  if (notFound) return <PageAlert message="Transaction not found" detail={`Hash: ${hash}`} />;
  if (unreachable) {
    return <PageAlert message={UNREACHABLE_MESSAGE} detail={`Hash: ${hash}`} onRetry={retry} />;
  }
  if (failed) {
    return (
      <PageAlert
        message="Couldn't load this transaction. The XRPL nodes didn't answer."
        detail={`Hash: ${hash}`}
        onRetry={retry}
      />
    );
  }
  if (!tx) return <TxSkeleton />;

  return (
    <>
      <PageTitle>{`Transaction ${short} — XRPL | Sonde`}</PageTitle>
      <TransactionDetail tx={tx} />
    </>
  );
}
