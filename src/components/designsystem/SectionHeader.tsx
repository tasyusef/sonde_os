export default function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-8">
      <h2 className="font-display text-title font-bold tracking-[-0.5px] text-primary">
        {title}
      </h2>
      <p className="mt-1 font-body text-body text-secondary">{subtitle}</p>
    </div>
  );
}
