import { useEffect } from "react";
import { useNavigate } from "react-router";
import PageAlert from "@/components/shared/PageAlert";
import IouToken from "@/components/token/IouToken";
import MptToken from "@/components/token/MptToken";
import { hitPath } from "@/lib/search";
import { parseTokenId, tokenId } from "@/lib/token-id";
import { findListing, useTokenList } from "@/lib/token-list";

/**
 * Token page body: an issued currency (`CODE.rIssuer`) or an MPT
 * (its issuance ID), read live from the ledger, with its name and
 * holder count from the token list when it's listed. An ID written
 * another way (a hex code that prints, lower case) moves to its usual
 * form, so each token has one URL.
 */
export default function TokenView({ id }: { id: string }) {
  const navigate = useNavigate();
  const ref = parseTokenId(id);
  const canonical = ref && tokenId(ref);
  const { list } = useTokenList(!!ref);
  const listed = list && ref ? findListing(list, ref) : null;

  useEffect(() => {
    if (canonical && canonical !== id) navigate(hitPath({ kind: "token", id: canonical }), { replace: true });
  }, [canonical, id, navigate]);

  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        {!ref || !canonical ? (
          <PageAlert message="Not a token ID" detail={`ID: ${id}`} />
        ) : ref.kind === "iou" ? (
          <IouToken currency={ref.currency} issuer={ref.issuer} id={canonical} listed={listed} />
        ) : (
          <MptToken id={canonical} listed={listed} />
        )}
      </main>
    </div>
  );
}
