// Minimal stroke icons (inline SVG, currentColor). Decorative only: always rendered next to a text label.
import type { SVGProps } from "react";

function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const IconHome = () => (
  <Icon>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Icon>
);
export const IconUsers = () => (
  <Icon>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
    <path d="M18 14.8c2 .7 3.2 2.4 3.5 5.2" />
  </Icon>
);
export const IconOrganization = () => (
  <Icon>
    <rect x="4" y="3" width="10" height="18" rx="1" />
    <path d="M14 9h6v12h-6" />
    <path d="M7.5 7h3M7.5 11h3M7.5 15h3" />
  </Icon>
);
export const IconDocs = () => (
  <Icon>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M14 3v5h5M9 13h7M9 17h5" />
  </Icon>
);
export const IconSignOut = () => (
  <Icon>
    <path d="M15 4h4v16h-4" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Icon>
);
export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const IconChevronDown = () => (
  <Icon width="14" height="14">
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const IconAttention = () => (
  <Icon width="15" height="15">
    <path d="M12 3.5 2.5 20h19z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Icon>
);
