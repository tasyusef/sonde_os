export default function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-8">
      <h2 className="font-display text-title font-bold text-primary">
        {title}
      </h2>
      <p className="mt-1 font-body text-body text-primary">{subtitle}</p>
    </div>
  );
}
