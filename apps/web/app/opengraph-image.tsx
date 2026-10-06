import { ImageResponse } from "next/og";

export const alt = "ReturnPilot — the returns agent that knows when to ask";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PILLS = ["MCP tools", "Policy engine", "Human approval", "Memory", "Traces"];
const TEXT = `ReturnPilotLive demoThe returns agent thatknows when to ask.${PILLS.join("")}`;

/** Plus Jakarta Sans subset from Google Fonts (TTF); falls back to the default font offline. */
async function loadFont(weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@${weight}&text=${encodeURIComponent(TEXT)}`,
      { signal: AbortSignal.timeout(4000) },
    ).then((r) => r.text());
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    return await fetch(url, { signal: AbortSignal.timeout(4000) }).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const [bold, semi] = await Promise.all([loadFont(800), loadFont(600)]);
  const fonts = [
    ...(bold ? [{ name: "Jakarta", data: bold, weight: 800 as const, style: "normal" as const }] : []),
    ...(semi ? [{ name: "Jakarta", data: semi, weight: 600 as const, style: "normal" as const }] : []),
  ];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 44,
          background: "linear-gradient(135deg, #F4F3FF 0%, #E7E8F4 45%, #D6D6F0 100%)",
          fontFamily: fonts.length ? "Jakarta" : "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            borderRadius: 44,
            overflow: "hidden",
            background: "#ECEEF8",
            boxShadow: "0 40px 80px -30px rgba(54,53,122,.55)",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              padding: "48px 56px 120px",
              background: "linear-gradient(140deg, #23224A 0%, #36357A 70%, #4B4AA3 100%)",
              color: "white",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "linear-gradient(145deg, #8D8CFF, #5A59E6)",
                }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14 4 9l5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                </svg>
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1 }}>ReturnPilot</div>
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  fontSize: 18,
                  fontWeight: 600,
                  padding: "8px 18px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,.12)",
                  border: "1px solid rgba(255,255,255,.2)",
                }}
              >
                Live demo
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 40, fontSize: 68, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>
              <span>The returns agent that</span>
              <span style={{ color: "#D9C8FF" }}>knows when to ask.</span>
            </div>
            <svg
              width="1112"
              height="110"
              viewBox="0 0 1440 110"
              preserveAspectRatio="none"
              style={{ position: "absolute", left: 0, bottom: -1 }}
            >
              <path d="M0 70 C 320 0, 560 120, 860 70 S 1260 20, 1440 60 L1440 110 L0 110 Z" fill="#ECEEF8" />
            </svg>
          </div>
          <div style={{ display: "flex", gap: 14, padding: "6px 56px 0", flexWrap: "wrap" }}>
            {PILLS.map((p) => (
              <div
                key={p}
                style={{
                  display: "flex",
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#4F5074",
                  padding: "12px 22px",
                  borderRadius: 999,
                  background: "#ECEEF8",
                  boxShadow: "-6px -6px 14px rgba(255,255,255,.9), 7px 8px 18px rgba(104,106,170,.28)",
                }}
              >
                {p}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
