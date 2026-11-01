import { Link } from "react-router";
import { useRetryRoute } from "@/hooks/useRetryRoute";

/**
 * Full-page error with a retry and a way home. Used by the root error
 * boundary, so it can't rely on the app shell's providers.
 */
export default function ErrorPage({ title, message }: { title: string; message: string }) {
  const retry = useRetryRoute();

  return (
    <main
      id="main-content"
      className="mx-auto flex max-w-container flex-col items-center justify-center px-4 py-24 text-center sm:px-6"
    >
      <div role="alert">
        <h1 className="font-display text-heading font-bold text-primary">{title}</h1>
        <p className="mt-2 font-body text-ui text-muted">{message}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={retry}
            className="bg-accent px-4 py-2 font-display text-caps uppercase text-on-accent hover:bg-primary hover:text-black"
          >
            Try again
          </button>
          <Link
            to="/"
            className="px-4 py-2 font-display text-caps uppercase text-primary shadow-card hover:bg-primary hover:text-black"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
