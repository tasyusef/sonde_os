"use client";

import { useState } from "react";
import { motion } from "motion/react";
import Button from "@/components/shared/Button";
import { SondeMark } from "@/components/shared/SondeLogo";

// SHA-256 hash of the gate password (client-side convenience gate, not a security boundary)
const HASH = "969a8c9e0ecb54f7f39738608bd0d0563224938b6afa905e10c38006e2eacadd";

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);

    const hash = await sha256(value);
    if (hash === HASH) {
      sessionStorage.setItem("ds-auth", "1");
      onSuccess();
    } else {
      setError(true);
      setValue("");
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-elevated bg-surface p-8 shadow-card"
      >
        <SondeMark size={32} className="text-brand" />

        <div className="w-full space-y-2">
          <label
            htmlFor="ds-password"
            className="block font-display text-tag uppercase tracking-header text-muted"
          >
            Password
          </label>
          <input
            id="ds-password"
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-elevated bg-elevated px-4 py-2.5 font-mono text-cell text-primary outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/50"
            placeholder="Enter password"
          />
          {error && (
            <motion.p
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              className="font-mono text-label text-error"
            >
              Incorrect password
            </motion.p>
          )}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          disabled={!value}
        >
          {loading ? "Checking..." : "Enter"}
        </Button>
      </motion.form>
    </div>
  );
}
