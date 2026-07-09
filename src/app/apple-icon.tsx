import { ImageResponse } from "next/og";
import { MARK_PATH } from "@/lib/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "180px",
          height: "180px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0B0D10",
          borderRadius: "36px",
        }}
      >
        <svg viewBox="0 0 331.75 332.99" width="110" height="110" fill="#E8856C">
          <path d={MARK_PATH} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
