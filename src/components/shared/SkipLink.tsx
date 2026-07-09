/** Visually-hidden skip link that becomes visible on keyboard focus.
 *  Lets keyboard users jump past the sidebar nav directly to <main>.
 *  Pair with a `<main id="main-content">` somewhere in the page tree. */
export default function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2 focus:font-body focus:text-primary focus:shadow-card"
    >
      Skip to main content
    </a>
  );
}
