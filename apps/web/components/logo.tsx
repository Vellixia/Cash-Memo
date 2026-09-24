/** Cash Memo mark: a paper receipt with a check on a ledger-green tile.
 * Kept in sync with app/icon.svg (the favicon) and app/apple-icon.png. */
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} role="img" aria-label="Cash Memo">
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="#1F7A5C" />
      <path d="M8.5,7 L23.5,7 L23.5,22 L21.6,24.5 L19.7,22 L17.9,24.5 L16,22 L14.1,24.5 L12.3,22 L10.4,24.5 L8.5,22 Z" fill="#FAF8F4" />
      <path d="M11.8,14.6 L14.6,17.4 L20.2,11.2" fill="none" stroke="#1F7A5C" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
