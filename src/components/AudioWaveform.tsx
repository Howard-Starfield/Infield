import type { SVGProps } from "react";

/** Bold static waveform icon (idle system-audio capture). Uses `currentColor`. */
export function AudioWaveform(props: SVGProps<SVGSVGElement>) {
  const { width = 26, height = 16, ...rest } = props;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 29 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      {/* Thick rounded caps read as “bold” at small sizes */}
      <rect x="0" y="11" width="4.5" height="7" rx="2.25" fill="currentColor" />
      <rect x="6" y="7" width="4.5" height="11" rx="2.25" fill="currentColor" />
      <rect x="12" y="2" width="4.5" height="16" rx="2.25" fill="currentColor" />
      <rect x="18" y="7" width="4.5" height="11" rx="2.25" fill="currentColor" />
      <rect x="24" y="11" width="4.5" height="7" rx="2.25" fill="currentColor" />
    </svg>
  );
}
