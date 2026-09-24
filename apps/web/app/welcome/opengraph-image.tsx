import { ImageResponse } from "next/og";

export const alt = "Cash Memo — your private money journal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ink = "#1C1B19";
const paper = "#FAF8F4";
const green = "#1F7A5C";
const terracotta = "#C2513A";
const muted = "#6B6760";
const line = "#E8E4DC";

const rows = [
  { dot: "#C2513A", title: "Ramen with Sam", amount: "−$14.50", color: terracotta },
  { dot: "#1F7A5C", title: "September salary", amount: "+$3,200.00", color: green },
  { dot: "#5B6FA8", title: "Flat white in Lisbon", amount: "−€3.80", color: terracotta },
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 80px",
          gap: 64,
          background: paper,
          color: ink,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg viewBox="0 0 32 32" width={56} height={56}>
              <rect x="1" y="1" width="30" height="30" rx="8.5" fill={green} />
              <path
                d="M8.5,7 L23.5,7 L23.5,22 L21.6,24.5 L19.7,22 L17.9,24.5 L16,22 L14.1,24.5 L12.3,22 L10.4,24.5 L8.5,22 Z"
                fill={paper}
              />
              <path d="M11.8,14.6 L14.6,17.4 L20.2,11.2" fill="none" stroke={green} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 34, fontWeight: 600 }}>Cash Memo</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 40, fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            <span>Your private</span>
            <span style={{ display: "flex", gap: 20 }}>
              <span style={{ color: green }}>money</span>
              <span>journal</span>
            </span>
          </div>
          <span style={{ marginTop: 28, fontSize: 28, color: muted, lineHeight: 1.35 }}>
            Any currency. No bank links, no ads, no selling your data.
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 400,
            padding: 28,
            borderRadius: 32,
            background: "#FFFFFF",
            border: `1px solid ${line}`,
            boxShadow: "0 30px 60px -30px rgba(28,27,25,0.35)",
          }}
        >
          <span style={{ fontSize: 20, color: muted }}>Net this month</span>
          <span style={{ fontSize: 60, color: green, marginTop: 4 }}>+$1,862.40</span>
          <div style={{ display: "flex", height: 10, marginTop: 20, borderRadius: 999, overflow: "hidden", background: "#F2EFE8" }}>
            <div style={{ width: "68%", background: green }} />
            <div style={{ width: 4, background: "#FFFFFF" }} />
            <div style={{ flex: 1, background: terracotta }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
            {rows.map((r) => (
              <div key={r.title} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderTop: `1px solid ${line}` }}>
                <div style={{ width: 14, height: 14, borderRadius: 999, background: r.dot }} />
                <span style={{ fontSize: 21, flex: 1 }}>{r.title}</span>
                <span style={{ fontSize: 22, color: r.color }}>{r.amount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
