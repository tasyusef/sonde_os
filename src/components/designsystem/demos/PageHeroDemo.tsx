import { useState } from "react";
import PageHero from "@/components/shared/PageHero";
import DemoCard from "../shared/DemoCard";
import { TextControl } from "../shared/PropControl";

export default function PageHeroDemo() {
  const [title, setTitle] = useState("Watchlist");

  return (
    <DemoCard
      name="PageHero"
      importPath="@/components/shared/PageHero"
      description="A page's title on the flat page ground. The title says what the page is; no subtitle."
      preview={
        <div className="w-full">
          <PageHero title={title} />
        </div>
      }
      controls={<TextControl label="title" value={title} onChange={setTitle} />}
      code={`<PageHero title="${title}" />`}
    />
  );
}
