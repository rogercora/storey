/**
 * Stacked condensed wordmark ("EVENT" over "STOREY") with both lines forced to
 * the exact same width so they form a tight block like the reference logo.
 */
export function Wordmark({ className = "h-12 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 64"
      className={`block fill-current ${className}`}
      role="img"
      aria-label="Event Storey"
    >
      <text
        x="0"
        y="29"
        fontSize="36"
        textLength="100"
        lengthAdjust="spacingAndGlyphs"
        className="font-display uppercase"
      >
        EVENT
      </text>
      <text
        x="0"
        y="61"
        fontSize="36"
        textLength="100"
        lengthAdjust="spacingAndGlyphs"
        className="font-display uppercase"
      >
        STOREY
      </text>
    </svg>
  );
}

export function BrandHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between bg-ink px-5 py-4 text-white">
      <Wordmark />
      {right}
    </header>
  );
}
