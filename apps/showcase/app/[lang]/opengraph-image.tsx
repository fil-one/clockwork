import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDictionary } from "../../lib/dictionaries";
import { isLocale, translator } from "../../lib/i18n";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default async function SocialImage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang: requested } = await params;
  const lang = isLocale(requested) ? requested : "en";
  const t = translator(await getDictionary(lang), lang);
  const [logo, font] = await Promise.all([
    readFile(join(process.cwd(), "public/brand/fo-wordmark-dark.png")),
    readFile(join(process.cwd(), `app/fonts/og-${lang}.ttf`)),
  ]);
  const rtl = lang === "ar";
  // Satori shapes Arabic glyphs but lays out whitespace-delimited words LTR.
  // Reverse word runs for these single-line RTL labels; retain glyph order.
  const text = (value: string) =>
    rtl ? value.replace(/\.$/, "").split(/\s+/).reverse().join(" ") : value;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#f7f9fc",
        color: "#102138",
        padding: "54px 66px",
        fontFamily: "Demo",
        flexDirection: "column",
        alignItems: rtl ? "flex-end" : "flex-start",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <img
          src={`data:image/png;base64,${logo.toString("base64")}`}
          alt=""
          width={156}
          height={45}
        />
        <span
          style={{
            fontFamily: "sans-serif",
            fontSize: 25,
            borderLeft: "1px solid #b7c9dc",
            paddingLeft: 24,
          }}
        >
          Commerce
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 40,
          fontSize: lang === "de" ? 52 : rtl ? 59 : 62,
          fontWeight: 500,
          letterSpacing: rtl ? "0px" : "-2px",
          lineHeight: 1.16,
          alignItems: rtl ? "flex-end" : "flex-start",
        }}
      >
        <span>
          {text(
            `${t("sales.every.deal.138f9")} ${t("sales.every.handoff.5fb84")}`,
          )}
        </span>
        <span style={{ color: "#006deb" }}>
          {text(t("sales.connected.5a61f"))}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 26,
          color: "#536881",
          marginTop: 25,
          maxWidth: 1050,
          textAlign: rtl ? "right" : "left",
          lineHeight: 1.5,
        }}
      >
        {text(t("sales.one.clear.path.from.a.customer.3dff4"))}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          gap: 18,
          alignItems: "center",
          fontSize: 19,
          flexDirection: rtl ? "row-reverse" : "row",
        }}
      >
        <span
          style={{
            background: "#006deb",
            color: "white",
            padding: "15px 23px",
            borderRadius: 7,
          }}
        >
          {text(t("sales.explore.capabilities.b22e3"))}
        </span>
        <span style={{ color: "#62758c", marginLeft: 10 }}>
          {text(
            `${t("sales.3.minute.interactive.tour.845f9")} · ${t("sales.no.sign.up.needed.e6c96")}`,
          )}
        </span>
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Demo", data: font, style: "normal", weight: 500 }],
    },
  );
}
