/**
 * One quiet line under every page: the copyright, Sonde on X and who
 * built it. The sidebar has the pages and the status strip the node.
 * At the foot of a short page it sits at the bottom of the screen, and
 * on a phone it keeps clear of the search button.
 */
export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-container flex-wrap gap-x-6 gap-y-2 px-4 pt-4 pb-[var(--floating-bottom-mobile)] font-mono text-label text-muted sm:px-6 md:pb-4">
        <p>&copy; {new Date().getFullYear()} Sonde</p>
        <a
          href="https://x.com/sonde_xrpl"
          target="_blank"
          rel="noopener noreferrer"
          className="link-quiet text-primary"
        >
          Sonde on X
        </a>
        <p>
          Built by{" "}
          <a
            href="https://timothyali.com"
            target="_blank"
            rel="noopener noreferrer"
            className="link-quiet text-primary"
          >
            Timothy Ali
          </a>
        </p>
      </div>
    </footer>
  );
}
