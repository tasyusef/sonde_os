import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { recentSearches } from "@/lib/recent-searches";
import { hitPath, looksLikeAddress, parseSearch, type SearchHit } from "@/lib/search";
import { tokenId } from "@/lib/token-id";
import { matchTokens, onlyMatch, useTokenList } from "@/lib/token-list";
import { type Suggestion, useSuggestions } from "./useSuggestions";

const NO_MATCH = "No match. Search takes an address, hash, ledger number, NFT ID or token.";
const ADDRESS_TYPO = "This address has a typo: its checksum doesn't match. Check it and try again.";

/**
 * Input, error, suggestions and submit for `UnifiedSearch`. An address,
 * a ledger number or a token ID opens its page and joins the recent
 * searches; a 64-hex ID goes to `/search/<id>`, which asks the ledger
 * what it is. Other text is a ticker or a name: the one token it names
 * opens, several go to `/search/<text>`. The token list loads on the
 * first focus or keystroke. Typing clears the error.
 */
export function useUnifiedSearch(onSubmit?: () => void) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listWanted, setListWanted] = useState(false);
  const q = input.trim();
  const hasInput = q !== "";
  const { list } = useTokenList(listWanted || hasInput);

  const open = (hit: SearchHit) => {
    onSubmit?.();
    recentSearches.add(hit);
    navigate(hitPath(hit));
  };
  const openText = () => {
    onSubmit?.();
    navigate(`/search/${encodeURIComponent(q)}`);
  };
  const suggestions = useSuggestions(list, input, (s: Suggestion) =>
    s === "all" ? openText() : open({ kind: "token", id: tokenId(s.ref) }),
  );

  const handleInput = (value: string) => {
    setInput(value);
    setError(null);
    suggestions.reset();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasInput) return;
    const parsed = parseSearch(q);
    if (parsed?.kind) return open({ kind: parsed.kind, id: parsed.id });
    if (parsed) {
      onSubmit?.();
      navigate(`/search/${parsed.id}`);
      return;
    }
    if (looksLikeAddress(q)) return setError(ADDRESS_TYPO);
    // Until the list is here, `/search/<text>` waits for it.
    if (!list) return openText();
    const only = onlyMatch(list.tokens, q);
    if (only) return open({ kind: "token", id: tokenId(only.ref) });
    if (matchTokens(list.tokens, q).length === 0) return setError(NO_MATCH);
    openText();
  };

  const inputProps = {
    ...suggestions.inputProps,
    onFocus: () => {
      setListWanted(true);
      suggestions.inputProps.onFocus();
    },
  };

  return { inputRef, input, hasInput, error, handleInput, handleSubmit, suggestions, inputProps };
}
