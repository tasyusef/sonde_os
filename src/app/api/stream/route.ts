import { liveDataManager } from "@/lib/live-data";
import type { LiveDataSnapshot } from "@/lib/live-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      unsubscribe = liveDataManager.subscribe((snapshot: LiveDataSnapshot) => {
        // Send each piece as a named event so clients can listen selectively
        send("ledger", snapshot.ledger);
        send("transactions", {
          txs: snapshot.transactions,
          total: snapshot.txCount,
        });
        send("stats", snapshot.stats);
        if (snapshot.fee) send("fee", snapshot.fee);
        if (snapshot.health) send("health", snapshot.health);
        if (snapshot.txDistribution.length > 0) {
          send("txDistribution", snapshot.txDistribution);
        }
        if (snapshot.price) send("price", snapshot.price);
        send("recentMints", snapshot.recentMints);
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
