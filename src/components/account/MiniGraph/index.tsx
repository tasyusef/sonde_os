"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import GraphView, { type GraphNode, type GraphEdge } from "@/components/intel/GraphView";
import NodeTooltip from "@/components/intel/GraphView/NodeTooltip";
import LinkTooltip from "@/components/intel/GraphView/LinkTooltip";
import CollapsibleCard from "@/components/shared/CollapsibleCard";

interface Counterparty {
  address: string;
  txCount: number;
  type: string;
}

interface CounterpartiesResponse {
  account: string;
  counterparties: Counterparty[];
}

/** Fetcher that returns null on auth errors instead of throwing. */
async function cpFetcher(url: string): Promise<CounterpartiesResponse | null> {
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

export default function MiniGraph({ address }: { address: string }) {
  const router = useRouter();

  const { data, isLoading } = useSWR<CounterpartiesResponse | null>(
    `/api/intel/counterparties?account=${encodeURIComponent(address)}`,
    cpFetcher,
    { dedupingInterval: 30_000, revalidateOnFocus: false },
  );

  const [hoveredNode, setHoveredNode] = useState<{ address: string; x: number; y: number } | null>(null);
  const [hoveredLink, setHoveredLink] = useState<{ edge: GraphEdge; x: number; y: number } | null>(null);

  // Convert counterparties to GraphView format
  const { nodes, edges } = useMemo(() => {
    if (!data || !data.counterparties || data.counterparties.length === 0) return { nodes: [], edges: [] };

    const nodes: GraphNode[] = [
      { address, first_seen: null, last_active: null },
      ...data.counterparties.map((cp) => ({
        address: cp.address,
        first_seen: null,
        last_active: null,
      })),
    ];

    const edges: GraphEdge[] = data.counterparties.map((cp) => ({
      from: address,
      to: cp.address,
      amount: cp.txCount,
      currency: "XRP",
      timestamp: 0,
      tx_hash: "",
      type: cp.type,
    }));

    return { nodes, edges };
  }, [data, address]);

  const handleNodeClick = useCallback(
    (addr: string) => {
      setHoveredNode(null);
      router.push(`/account/${addr}`);
    },
    [router],
  );

  // Loading state — show full card chrome with a skeleton body so the
  // sidebar doesn't reflow when data arrives.
  if (isLoading) {
    return (
      <CollapsibleCard title="Top Counterparties" storageKey="mini-graph">
        <div className="p-2">
          <div
            className="h-[180px] animate-pulse motion-reduce:animate-none rounded-2xl bg-elevated"
            role="status"
            aria-label="Loading counterparty graph"
          />
        </div>
      </CollapsibleCard>
    );
  }

  // Hide the whole card (chrome included) when we have no data — covers
  // the auth-gated/free-tier case so users don't see an empty stub.
  if (nodes.length === 0) return null;

  return (
    <CollapsibleCard title="Top Counterparties" storageKey="mini-graph">
      <div className="p-2">
        <div className="relative">
          <GraphView
            nodes={nodes}
            edges={edges}
            focusAddress={address}
            onNodeClick={handleNodeClick}
            onNodeHover={(addr, x, y) => {
              setHoveredLink(null);
              setHoveredNode(addr ? { address: addr, x, y } : null);
            }}
            onLinkHover={(edge, x, y) => {
              setHoveredNode(null);
              setHoveredLink(edge ? { edge, x, y } : null);
            }}
            className="h-[180px]"
          />
          {hoveredNode && (
            <NodeTooltip
              address={hoveredNode.address}
              screenX={hoveredNode.x}
              screenY={hoveredNode.y}
              edges={edges}
              onSetActiveAccount={handleNodeClick}
            />
          )}
          {hoveredLink && (
            <LinkTooltip
              edge={hoveredLink.edge}
              screenX={hoveredLink.x}
              screenY={hoveredLink.y}
            />
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}
