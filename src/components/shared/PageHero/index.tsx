/** A page's title, on the flat page ground. */
export default function PageHero({ title }: { title: string }) {
  return (
    <section>
      <div className="mx-auto max-w-container px-4 pt-6 pb-3 sm:px-6 sm:pt-8 sm:pb-4">
        <h1 className="font-display text-heading font-bold text-primary sm:text-title">
          {title}
        </h1>
      </div>
    </section>
  );
}
