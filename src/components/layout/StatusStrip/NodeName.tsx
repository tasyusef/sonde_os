import { useXrpl } from "@/hooks/useXrplWs";

/** The public node this browser reads from, while connected: the site
 *  has no server of its own. */
export function NodeName({ className }: { className?: string }) {
  const { connected, activeNode } = useXrpl();
  if (!connected || !activeNode) return null;
  return <span className={className}>via {activeNode}</span>;
}
