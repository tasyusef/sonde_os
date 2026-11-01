import { Link } from "react-router";
import AddressLink from "@/components/shared/AddressLink";

/** A token's issuer: its name when the list or the site knows it,
 *  else its address. Either opens the account. */
export default function IssuerLink({ address, name }: { address: string; name?: string }) {
  if (!name) return <AddressLink address={address} />;
  return (
    <Link to={`/account/${address}`} title={address} className="link">
      {name}
    </Link>
  );
}
