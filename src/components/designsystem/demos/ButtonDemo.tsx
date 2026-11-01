import { useState } from "react";
import Button, { type ButtonVariant, type ButtonSize } from "@/components/shared/Button";
import PixelIcon from "@/components/shared/PixelIcon";
import DemoCard from "../shared/DemoCard";
import { SelectControl, ToggleControl, TextControl } from "../shared/PropControl";

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
        description="Universal button primitive. Every button on the site routes through this. Use variants for intent (primary/secondary/ghost/outline/danger), sizes for scale, and loading/iconOnly for state. Wrap in a React Router <Link> or use the buttonClasses() helper for navigation buttons."
        preview={
          <div className="flex items-center justify-center p-6">
            <Button
              variant={variant}
              size={size}
              iconOnly={iconOnly}
              loading={loading}
              disabled={disabled}
              fullWidth={fullWidth}
              leftIcon={iconOnly ? <PixelIcon name="plus" /> : undefined}
              rightIcon={!iconOnly && variant === "primary" ? <PixelIcon name="arrow" /> : undefined}
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
  ${iconOnly ? '<PixelIcon name="plus" />' : label}
</Button>`}
      />

      {/* Variant overview — static showcase */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h4 className="mb-4 font-display text-caps uppercase tracking-header text-muted">
          All variants
        </h4>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <h4 className="mb-4 mt-6 font-display text-caps uppercase tracking-header text-muted">
          All sizes
        </h4>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <h4 className="mb-4 mt-6 font-display text-caps uppercase tracking-header text-muted">
          States
        </h4>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button leftIcon={<PixelIcon name="plus" />}>With icon</Button>
          <Button iconOnly aria-label="Add">
            <PixelIcon name="plus" />
          </Button>
        </div>
      </div>
    </div>
  );
}
