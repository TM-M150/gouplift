/* eslint-disable @next/next/no-img-element -- drawn by Satori (next/og), not a browser: next/image can't run there */
import Logo from "@/components/icons/logo";
import {
  SHARE_CARD_SIZE,
  shareCardTitleSize,
  type ShareCardFigures,
} from "@/lib/share-card";

// The brand colours, as the hex values Satori needs (the site's own are oklch).
// The bright green is only ever used on the dark green here (7.2:1), and the
// soft green for secondary words on it (10:1).
const FOREST = "#072b19";
const SIGNAL = "#09cc60";
const MINT = "#e9faed";
const SOFT = "#cfe3d7";

/** How much of the card's width the photo takes. */
export const SHARE_CARD_PHOTO = {
  width: 480,
  height: SHARE_CARD_SIZE.height,
} as const;

const RULE = 10;

/**
 * What a link to a fundraiser looks like in a preview: its photo on the left
 * and, on the dark green beside it, the title, how much it has raised and a
 * progress bar. A preview shows this about 330 pixels wide, so the words are
 * set large and there are few of them.
 *
 * `photo` is a data address for the picture already cut to
 * SHARE_CARD_PHOTO, or null for the logo on pale green.
 */
export function ShareCard({
  title,
  kind,
  figures,
  photo,
}: {
  title: string;
  kind: string;
  figures: ShareCardFigures;
  photo: string | null;
}) {
  const { width, height } = SHARE_CARD_SIZE;

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        background: FOREST,
        color: "#ffffff",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          width: SHARE_CARD_PHOTO.width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: MINT,
        }}
      >
        {photo ? (
          <img
            src={photo}
            width={SHARE_CARD_PHOTO.width}
            height={SHARE_CARD_PHOTO.height}
            alt=""
            style={{ objectFit: "cover" }}
          />
        ) : (
          <Logo size={240} rx={54} />
        )}
      </div>

      <div style={{ width: RULE, height, background: SIGNAL }} />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "44px 52px 48px 52px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Logo size={48} rx={11} />
            <div style={{ fontSize: 32, fontWeight: 700 }}>GoUplift</div>
          </div>
          <div style={{ fontSize: 26, color: SOFT }}>gouplift.africa</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              // Satori only cuts a title off with "…" (lineClamp) on a block.
              display: "block",
              fontSize: shareCardTitleSize(title),
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: -1,
              lineClamp: 3,
              wordBreak: "break-word",
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 28, color: SOFT }}>{kind}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              color: SIGNAL,
            }}
          >
            {figures.headline}
          </div>
          <div style={{ fontSize: 30, color: SOFT, marginTop: 4 }}>
            {figures.caption}
          </div>

          <div
            style={{
              display: "flex",
              height: 28,
              marginTop: 20,
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.18)",
            }}
          >
            <div
              style={{
                width: `${figures.barPercent}%`,
                height: 28,
                borderRadius: 14,
                background: SIGNAL,
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 16,
              fontSize: 32,
            }}
          >
            <div style={{ fontWeight: 600 }}>{figures.status}</div>
            {figures.donations && (
              <div style={{ color: SOFT }}>{figures.donations}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
