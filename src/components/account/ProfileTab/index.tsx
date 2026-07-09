"use client";

import { useMemo, useState } from "react";
import ResponsiveSelect, {
  type ResponsiveSelectOption,
} from "@/components/shared/ResponsiveSelect";
import SectionHeader from "@/components/shared/SectionHeader";
import SettingsList from "@/components/account/SettingsList";
import AncestryDisplay from "@/components/account/AncestryDisplay";
import ActivationsList from "@/components/account/ActivationsList";
import ObjectsList, { type LedgerObject } from "@/components/account/ObjectsList";
import { useAccountObjects } from "@/hooks/useAccountObjects";
import { useAccountActivations } from "@/hooks/useAccountActivations";
import { useAccountAncestry } from "@/hooks/useAccountAncestry";
import type { AccountSettings } from "@/types/xrpl";
import type { AncestryData } from "@/hooks/useAccountData";

type ProfileView = "settings" | "ancestry" | "activations" | "objects";

interface ProfileTabProps {
  address: string;
  accountSettings: AccountSettings;
  /** Server-rendered ancestry from `initialHistory.ancestry`. When null,
   *  `useAccountAncestry` falls back to a rippled WS call. */
  initialAncestry: AncestryData | null;
}

/**
 * Combined "Profile" tab — identity and low-level technical metadata.
 * Settings + Ancestry + Activations + Objects, behind a single dropdown.
 *
 * Tier 2 migration: this tab now owns its data via three hooks
 * (`useAccountObjects`, `useAccountActivations`, `useAccountAncestry`)
 * instead of receiving everything pre-loaded from the parent monolith.
 * The dropdown stays stable during load (all 4 options always visible);
 * counts populate as data arrives, and per-view headers narrate what's
 * loading via `SectionHeader`.
 */
export default function ProfileTab({
  address,
  accountSettings,
  initialAncestry,
}: ProfileTabProps) {
  const [view, setView] = useState<ProfileView>("settings");

  const objectsState = useAccountObjects(address);
  const activationsState = useAccountActivations(address);
  const ancestryState = useAccountAncestry(address, initialAncestry);

  const activationsCount = activationsState.activations.length;
  const objectsCount = objectsState.objects.length;

  // All 4 options always visible. Progressive loading drives counts +
  // per-section status; the dropdown itself doesn't shuffle as data
  // arrives. Empty-state inside each view explains "no data."
  const options = useMemo<ResponsiveSelectOption<ProfileView>[]>(
    () => [
      { value: "settings", label: "Settings" },
      { value: "ancestry", label: "Ancestry" },
      {
        value: "activations",
        label: "Activations",
        desktopLabel:
          activationsCount > 0 ? (
            <>
              Activations{" "}
              <span className="opacity-60">({activationsCount})</span>
            </>
          ) : (
            "Activations"
          ),
      },
      {
        value: "objects",
        label: "Objects",
        desktopLabel:
          objectsCount > 0 ? (
            <>
              Objects <span className="opacity-60">({objectsCount})</span>
            </>
          ) : (
            "Objects"
          ),
      },
    ],
    [activationsCount, objectsCount],
  );

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 items-center justify-end">
        <ResponsiveSelect
          options={options}
          active={view}
          onChange={setView}
          ariaLabel="Profile section"
          desktopVariant="select"
        />
      </div>

      {view === "settings" && <SettingsList settings={accountSettings} />}

      {view === "ancestry" && (
        <div className="space-y-3">
          {ancestryState.isLoading ? (
            <div className="rounded-2xl bg-surface p-4 shadow-card">
              <SectionHeader
                title="Ancestry"
                status="Looking up activator…"
              />
            </div>
          ) : (
            <AncestryDisplay
              ancestry={ancestryState.ancestry}
              accountSettings={accountSettings}
            />
          )}
        </div>
      )}

      {view === "activations" && (
        <div className="space-y-3">
          <SectionHeader
            title="Activations"
            count={activationsCount}
            status={
              activationsState.isLoading
                ? "Loading lifetime activations…"
                : null
            }
          />
          <ActivationsList activations={activationsState.activations} />
        </div>
      )}

      {view === "objects" && (
        <div className="space-y-3">
          <SectionHeader
            title="Objects"
            count={objectsCount}
            status={
              objectsState.isLoading ? "Loading account objects…" : null
            }
          />
          <ObjectsList
            objects={objectsState.objects as unknown as LedgerObject[]}
          />
        </div>
      )}
    </div>
  );
}
