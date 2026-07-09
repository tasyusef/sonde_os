"use client";

import SearchBar from "@/components/layout/SearchBar";
import DemoCard from "../shared/DemoCard";

export default function SearchBarDemo() {
  return (
    <DemoCard
      name="SearchBar"
      importPath="@/components/layout/SearchBar"
      description="Universal search input for accounts, transactions, CTIDs, NFT IDs, tokens, and ledgers. Includes an inline search submit button that becomes active when the input has content. Two variants: 'standalone' (with border divider) for top-of-page placement and 'hero' (just the input) for embedding in hero sections."
      preview={
        <div className="p-6">
          <SearchBar variant="hero" />
        </div>
      }
      code={`<SearchBar />
// or:
<SearchBar variant="hero" />`}
    />
  );
}
