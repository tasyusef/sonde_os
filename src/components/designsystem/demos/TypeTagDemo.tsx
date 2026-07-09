"use client";

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
];

export default function TypeTagDemo() {
  const [txType, setTxType] = useState("Payment");

  return (
    <DemoCard
      name="TypeTag"
      importPath="@/components/shared/TypeTag"
      description="Square tag with 10% opacity background. Color mapped automatically from transaction type via getTypeColor()."
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
