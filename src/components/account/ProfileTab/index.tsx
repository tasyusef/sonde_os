import { useMemo, useState } from "react";
import ResponsiveSelect, {
  type ResponsiveSelectOption,
} from "@/components/shared/ResponsiveSelect";
import Section from "@/components/shared/Section";
import SettingsList from "@/components/account/SettingsList";
import AncestryDisplay from "@/components/account/AncestryDisplay";
import ObjectsList, { type LedgerObject } from "@/components/account/ObjectsList";
import { useAccountObjects } from "@/hooks/useAccountObjects";
import { useAccountAncestry } from "@/hooks/useAccountAncestry";
import type { AccountSettings } from "@/types/xrpl";

type ProfileView = "settings" | "ancestry" | "objects";

interface ProfileTabProps {
  address: string;
  accountSettings: AccountSettings;
}

/**
 * Combined "Profile" tab — identity and low-level technical metadata.
 * Settings + Ancestry + Objects behind one picker. Each view owns its
 * data (`useAccountObjects`, `useAccountAncestry`); the picker stays
 * stable during load, with counts filling in as data arrives.
 */
export default function ProfileTab({
  address,
  accountSettings,
}: ProfileTabProps) {
  const [view, setView] = useState<ProfileView>("settings");

  const objectsState = useAccountObjects(address);
  const ancestryState = useAccountAncestry(address);

  const objectsCount = objectsState.objects.length;

  // All options always visible. Progressive loading drives counts +
  // per-section status; the dropdown itself doesn't shuffle as data
  // arrives. Empty-state inside each view explains "no data."
  const options = useMemo<ResponsiveSelectOption<ProfileView>[]>(
    () => [
      { value: "settings", label: "Settings" },
      { value: "ancestry", label: "Ancestry" },
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
    [objectsCount],
  );

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 items-center justify-end">
        <ResponsiveSelect
          options={options}
          active={view}
          onChange={setView}
          ariaLabel="Profile section"
        />
      </div>

      {view === "settings" && <SettingsList settings={accountSettings} />}

      {view === "ancestry" && (
        ancestryState.isLoading ? (
          <Section title="Ancestry" status="Looking up activator…">
            {null}
          </Section>
        ) : (
          <AncestryDisplay
            ancestry={ancestryState.ancestry}
            accountSettings={accountSettings}
            onRetry={ancestryState.failed ? ancestryState.retry : undefined}
          />
        )
      )}

      {view === "objects" && (
        <Section
          title="Objects"
          count={objectsCount}
          status={objectsState.isLoading ? "Loading account objects…" : null}
        >
          <ObjectsList objects={objectsState.objects as unknown as LedgerObject[]} />
        </Section>
      )}
    </div>
  );
}
