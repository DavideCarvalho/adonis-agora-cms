import type { SVGProps } from 'react';

/**
 * CMS-only glyphs the kit's `icons.tsx` does not have, drawn like the kit's: 16×16, 1.6 stroke,
 * currentColor, decorative by default.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** The console mark: a page with a folded corner and two lines of copy. */
export function CmsMark(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 1.75h5l3 3v9.5H4z" />
      <path d="M9 1.75v3h3M6.25 8.5h3.5M6.25 11h2.5" />
    </Glyph>
  );
}

/** A collection of documents. */
export function DocumentsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 3.5h5.5l2 2v8H5z" />
      <path d="M3 5.5v8.75h7.5" />
    </Glyph>
  );
}

/** A global (a singleton document shared by the whole site). */
export function GlobeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.6 1.7 2.4 3.7 2.4 6S9.6 12.3 8 14M8 2C6.4 3.7 5.6 5.7 5.6 8s.8 4.3 2.4 6" />
    </Glyph>
  );
}

/** Media / uploads. */
export function ImageIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.25" />
      <path d="m14 11-3.5-3.5L4 13.5" />
    </Glyph>
  );
}

/** An app-registered view (extension). */
export function PuzzleIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 4.5h3a1.5 1.5 0 1 1 3 0h3v3a1.5 1.5 0 1 1 0 3v3H9a1.5 1.5 0 1 0-3 0H3z" />
    </Glyph>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 2.5v8M4.75 7.5 8 10.75 11.25 7.5M2.5 13.5h11" />
    </Glyph>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 10.5v-8M4.75 5.75 8 2.5l3.25 3.25M2.5 13.5h11" />
    </Glyph>
  );
}

export function BookmarkPlusIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 2h8v12l-4-2.75L4 14z" />
      <path d="M8 4.75v3.5M6.25 6.5h3.5" />
    </Glyph>
  );
}

export function BookmarkXIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 2h8v12l-4-2.75L4 14z" />
      <path d="m6.5 5 3 3M9.5 5l-3 3" />
    </Glyph>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="m7.6 8.4 5.9-5.9M11.5 4.5l1.75 1.75" />
    </Glyph>
  );
}
