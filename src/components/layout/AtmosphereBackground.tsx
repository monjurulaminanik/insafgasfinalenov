import { useThemeSettings } from "@/lib/theme";

/** Animated industrial gas / pipe atmosphere behind the app shell. */
export function AtmosphereBackground() {
  const { bgTheme, motionEnabled } = useThemeSettings();

  if (bgTheme === "clean-minimal") return null;

  return (
    <div
      className="app-atmosphere"
      aria-hidden
      data-theme={bgTheme}
      data-motion={motionEnabled ? "on" : "off"}
    >
      <div className="atm-wash" />
      {(bgTheme === "industrial-gas" || bgTheme === "midnight-plant") && (
        <>
          <svg className="atm-pipes" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="pipeMetal" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(148,163,184,0.35)" />
                <stop offset="50%" stopColor="rgba(71,85,105,0.45)" />
                <stop offset="100%" stopColor="rgba(148,163,184,0.25)" />
              </linearGradient>
              <linearGradient id="gasFlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(34,211,238,0)" />
                <stop offset="45%" stopColor="rgba(34,211,238,0.55)" />
                <stop offset="100%" stopColor="rgba(251,191,36,0)" />
              </linearGradient>
            </defs>
            <path
              className="pipe-body"
              d="M-40 160 H420 Q480 160 480 220 V420 Q480 480 540 480 H1280"
              fill="none"
              stroke="url(#pipeMetal)"
              strokeWidth="28"
              strokeLinecap="round"
            />
            <path
              className="pipe-body"
              d="M1280 620 H780 Q720 620 720 560 V320 Q720 260 660 260 H-40"
              fill="none"
              stroke="url(#pipeMetal)"
              strokeWidth="22"
              strokeLinecap="round"
            />
            <path
              className="pipe-body"
              d="M200 -20 V280 Q200 340 260 340 H520"
              fill="none"
              stroke="url(#pipeMetal)"
              strokeWidth="18"
              strokeLinecap="round"
            />
            <path
              className="gas-stream"
              d="M-40 160 H420 Q480 160 480 220 V420 Q480 480 540 480 H1280"
              fill="none"
              stroke="url(#gasFlow)"
              strokeWidth="6"
              strokeDasharray="18 28"
            />
            <path
              className="gas-stream gas-stream-b"
              d="M1280 620 H780 Q720 620 720 560 V320 Q720 260 660 260 H-40"
              fill="none"
              stroke="url(#gasFlow)"
              strokeWidth="5"
              strokeDasharray="14 24"
            />
            <circle className="valve" cx="480" cy="220" r="16" />
            <circle className="valve" cx="720" cy="320" r="14" />
            <circle className="valve" cx="540" cy="480" r="15" />
          </svg>
          <div className="atm-orbs">
            <span className="orb orb-a" />
            <span className="orb orb-b" />
            <span className="orb orb-c" />
          </div>
        </>
      )}
      <div className="atm-grid" />
    </div>
  );
}
