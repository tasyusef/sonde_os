"use client";

import { useState } from "react";
import PasswordGate from "./PasswordGate";
import DSNav from "./DSNav";
import ColorSection from "./ColorSection";
import TypographySection from "./TypographySection";
import ShadowSection from "./ShadowSection";
import ComponentSection from "./ComponentSection";

export default function DesignSystemPage() {
  const [authed, setAuthed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("ds-auth") === "1";
  });

  if (!authed) {
    return <PasswordGate onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen bg-black">
      <DSNav />

      <main id="main-content" className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6">
        <div className="space-y-20">
          <ColorSection />
          <TypographySection />
          <ShadowSection />
          <ComponentSection />
        </div>
      </main>
    </div>
  );
}
