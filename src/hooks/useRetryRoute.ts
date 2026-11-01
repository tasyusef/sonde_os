import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * "Try again" for a route `ErrorBoundary`. React Router clears a caught
 * render error when the location changes, so this replaces the current
 * entry with the same URL, which remounts the page from scratch.
 */
export function useRetryRoute(): () => void {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  return useCallback(() => {
    void navigate({ pathname, search, hash }, { replace: true, preventScrollReset: true });
  }, [navigate, pathname, search, hash]);
}
