import LedgerTxRow from "@/components/ledger/LedgerTxRow";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import Section from "@/components/shared/Section";
import type { RecentTx } from "@/types/live-data";

/** Busy mainnet ledgers carry 300 to 1,000 txs; render them 50 at a time. */
const PAGE_SIZE = 50;

export default function LedgerTransactionList({
  transactions,
  className,
}: {
  transactions: RecentTx[];
  className?: string;
}) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(
    transactions.length,
    PAGE_SIZE,
  );

  return (
    <Section title="Transactions" count={transactions.length} className={className}>
      {transactions.length === 0 ? (
        <ListNotice message="No transactions in this ledger" />
      ) : (
        <div ref={listRef}>
          {/* Rows in their own box, so the last one drops its rule above the footer's. */}
          <div>
            {transactions.slice(0, visible).map((tx) => (
              <LedgerTxRow key={tx.hash} tx={tx} />
            ))}
          </div>
          {hasMore && (
            <LoadMoreFooter
              visible={visible}
              total={transactions.length}
              onLoadMore={loadMore}
              onShowAll={showAll}
              label="transactions"
            />
          )}
        </div>
      )}
    </Section>
  );
}
