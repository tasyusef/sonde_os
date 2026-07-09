"use client";

import { useState } from "react";
import Button, { type ButtonVariant, type ButtonSize } from "@/components/shared/Button";
import DemoCard from "../shared/DemoCard";
import { SelectControl, ToggleControl, TextControl } from "../shared/PropControl";

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14M12 5l7 7-7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ButtonDemo() {
  const [variant, setVariant] = useState<ButtonVariant>("primary");
  const [size, setSize] = useState<ButtonSize>("md");
  const [iconOnly, setIconOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [fullWidth, setFullWidth] = useState(false);
  const [label, setLabel] = useState("Launch Explorer");

  return (
    <div className="space-y-8">
      <DemoCard
        name="Button"
        importPath="@/components/shared/Button"
        description="Universal button primitive. Every button on the site routes through this. Use variants for intent (primary/secondary/ghost/outline/danger), sizes for scale, and loading/iconOnly for state. Wrap in a Next.js <Link> or use the buttonClasses() helper for navigation buttons."
        preview={
          <div className="flex items-center justify-center p-6">
            <Button
              variant={variant}
              size={size}
              iconOnly={iconOnly}
              loading={loading}
              disabled={disabled}
              fullWidth={fullWidth}
              leftIcon={iconOnly ? <PlusIcon /> : undefined}
              rightIcon={!iconOnly && variant === "primary" ? <ArrowIcon /> : undefined}
              aria-label={iconOnly ? label : undefined}
            >
              {!iconOnly && label}
            </Button>
          </div>
        }
        controls={
          <>
            <SelectControl
              label="variant"
              value={variant}
              options={[
                { value: "primary", label: "primary" },
                { value: "secondary", label: "secondary" },
                { value: "ghost", label: "ghost" },
                { value: "outline", label: "outline" },
                { value: "danger", label: "danger" },
              ]}
              onChange={(v) => setVariant(v as ButtonVariant)}
            />
            <SelectControl
              label="size"
              value={size}
              options={[
                { value: "sm", label: "sm" },
                { value: "md", label: "md" },
                { value: "lg", label: "lg" },
              ]}
              onChange={(v) => setSize(v as ButtonSize)}
            />
            <TextControl label="children" value={label} onChange={setLabel} placeholder="Button label" />
            <ToggleControl label="iconOnly" checked={iconOnly} onChange={setIconOnly} />
            <ToggleControl label="loading" checked={loading} onChange={setLoading} />
            <ToggleControl label="disabled" checked={disabled} onChange={setDisabled} />
            <ToggleControl label="fullWidth" checked={fullWidth} onChange={setFullWidth} />
          </>
        }
        code={`<Button
  variant="${variant}"
  size="${size}"${loading ? "\n  loading" : ""}${disabled ? "\n  disabled" : ""}${fullWidth ? "\n  fullWidth" : ""}${iconOnly ? `\n  iconOnly\n  aria-label="${label}"` : ""}
>
  ${iconOnly ? "<PlusIcon />" : label}
</Button>`}
      />

      {/* Variant overview — static showcase */}
      <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
        <h4 className="mb-4 font-display text-label font-medium uppercase tracking-header text-muted">
          All variants
        </h4>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <h4 className="mb-4 mt-6 font-display text-label font-medium uppercase tracking-header text-muted">
          All sizes
        </h4>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <h4 className="mb-4 mt-6 font-display text-label font-medium uppercase tracking-header text-muted">
          States
        </h4>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button leftIcon={<PlusIcon />}>With icon</Button>
          <Button iconOnly aria-label="Add">
            <PlusIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
