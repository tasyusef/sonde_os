import { useState } from "react";
import Tabs from "@/components/shared/Tabs";
import DemoCard from "../shared/DemoCard";

const sampleTabs = [
  { id: "overview", label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "tokens", label: "Tokens" },
  { id: "nfts", label: "NFTs" },
  { id: "escrows", label: "Escrows" },
  { id: "offers", label: "Offers" },
  { id: "channels", label: "Channels" },
];

export default function TabsDemo() {
  const [active, setActive] = useState("overview");

  return (
    <DemoCard
      name="Tabs"
      importPath="@/components/shared/Tabs"
      description="Responsive tab bar with automatic 'More' dropdown overflow. Full keyboard navigation and ARIA."
      preview={
        <div className="w-full max-w-lg">
          <Tabs tabs={sampleTabs} activeTab={active} onChange={setActive} />
          <div
            role="tabpanel"
            aria-labelledby={`${active}-tab`}
            className="mt-4 rounded-lg border border-line bg-elevated/30 px-4 py-3 font-mono text-cell text-primary"
          >
            Content for &ldquo;{sampleTabs.find((t) => t.id === active)?.label}&rdquo; tab
          </div>
        </div>
      }
      code={`<Tabs
  tabs={[${sampleTabs.map((t) => `{ id: "${t.id}", label: "${t.label}" }`).join(", ")}]}
  activeTab="${active}"
  onChange={setActive}
/>`}
    />
  );
}
