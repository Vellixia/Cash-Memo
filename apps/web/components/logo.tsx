/** Cash Memo mark: a gradient tile with a receipt shape and checkmark.
 * Kept in sync with app/icon.svg (the favicon) and app/apple-icon.png. */
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Cash Memo"
    >
      <defs>
        <linearGradient id="cashmemo-logo-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#cashmemo-logo-g)" />
      <path
        d="M8,7 L24,7 L24,21 L22,24 L20,21 L18,24 L16,21 L14,24 L12,21 L10,24 L8,21 Z"
        fill="#fff"
      />
      <path
        d="M11.5,14.2 L14.5,17.2 L20.5,10.2"
        fill="none"
        stroke="#0d9488"
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
