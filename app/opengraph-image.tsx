import { ImageResponse } from "next/og";
import Logo from "@/components/icons/logo";
import { SITE_NAME } from "@/lib/site";

// The picture shown when a GoUplift link is shared. Built here rather than
// kept as a file so it uses the real logo and can't go stale.
export const alt = "GoUplift: crowdfunding for Kenya";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BRAND_DARK = "#072b19";
const BRAND_GREEN = "#09cc60";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BRAND_DARK,
          color: "#ffffff",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Logo size={96} rx={22} />
          <div style={{ fontSize: 44, fontWeight: 700 }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            Crowdfunding for Kenya
          </div>
          <div style={{ fontSize: 34, lineHeight: 1.3, color: "#b6d3c3" }}>
            Start a fundraiser, tell your story and accept donations in Kenyan
            shillings or US dollars.
          </div>
        </div>

        <div
          style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}
        >
          <div
            style={{ width: 56, height: 8, borderRadius: 4, background: BRAND_GREEN }}
          />
          <div style={{ color: BRAND_GREEN }}>gouplift.africa</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
