// Recharts takes SVG props, not Tailwind classes — these values must mirror
// the @theme tokens in src/styles.css.
export const chart = {
  line: "#28EBCF",
  lineNegative: "#FF4D5E",
  gradientFrom: "rgba(40,235,207,0.28)",
  gradientTo: "rgba(40,235,207,0)",
  gradientFromNeg: "rgba(255,77,94,0.22)",
  gradientToNeg: "rgba(255,77,94,0)",
  grid: "#232428",
  axisTick: { fontSize: 11, fill: "#63666E" },
  tooltip: {
    backgroundColor: "#1A1B1F",
    border: "1px solid #34363C",
    borderRadius: 12,
    boxShadow: "0 8px 24px -4px rgb(0 0 0 / 0.5)",
    fontSize: 12,
  },
  tooltipLabel: { color: "#9EA1AA" },
  cursor: { stroke: "#34363C", strokeWidth: 1 },
} as const;
