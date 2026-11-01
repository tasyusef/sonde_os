import { useState } from "react";
import { TypeTag } from "@/components/shared/TypeTag";
import DemoCard from "../shared/DemoCard";
import { SelectControl } from "../shared/PropControl";

const types = [
  "Payment",
  "OfferCreate",
  "OfferCancel",
  "NFTokenMint",
  "NFTokenAcceptOffer",
  "TrustSet",
  "AMMCreate",
  "AMMDeposit",
  "EscrowCreate",
  "EscrowFinish",
  "AccountSet",
  "AccountDelete",
  "CheckCreate",
  "PaymentChannelCreate",
  "TicketCreate",
];

export default function TypeTagDemo() {
  const [txType, setTxType] = useState("Payment");

  return (
    <DemoCard
      name="TypeTag"
      importPath="@/components/shared/TypeTag"
      description="Square tag in the type's family hue (tag-*): the hue as text on a 10% tint on the dark ground, the hue as a solid fill with ink on paper. Both reach 4.5:1."
      preview={<TypeTag txType={txType} />}
      controls={
        <SelectControl
          label="txType"
          value={txType}
          options={types.map((t) => ({ value: t, label: t }))}
          onChange={setTxType}
        />
      }
      code={`<TypeTag txType="${txType}" />`}
    />
  );
}
