import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function S({ children, ...props }: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: P) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);

export const IconHistory = (p: P) => (
  <S {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5V9H8" />
    <path d="M12 8v4.5l3 1.8" />
  </S>
);

export const IconStar = (p: P) => (
  <S {...p}>
    <path d="M12 3.8l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 17.1l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85L12 3.8z" />
  </S>
);

export const IconBoard = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="4.5" rx="2" />
    <rect x="13.5" y="11" width="7" height="9.5" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
  </S>
);

export const IconDatabase = (p: P) => (
  <S {...p}>
    <ellipse cx="12" cy="6" rx="7.5" ry="3" />
    <path d="M4.5 6v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" />
    <path d="M4.5 12v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" />
  </S>
);

export const IconChevronDown = (p: P) => (
  <S {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </S>
);

export const IconChevronUp = (p: P) => (
  <S {...p}>
    <path d="M6 14.5l6-6 6 6" />
  </S>
);

export const IconHelp = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.5v.3" />
    <path d="M12 16.6h.01" />
  </S>
);

export const IconSend = (p: P) => (
  <S {...p}>
    <path d="M4.4 11.9 20 4.3l-4.6 15.4-3.5-5.6-5.5-1.6z" />
    <path d="M11.9 14.1 20 4.3" />
  </S>
);

export const IconSpark = (p: P) => (
  <S {...p}>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5z" />
    <path d="M18.6 16.4l.75 2 2 .75-2 .75-.75 2-.75-2-2-.75 2-.75.75-2z" />
  </S>
);

export const IconCheck = (p: P) => (
  <S {...p}>
    <path d="M5 12.6l4.4 4.4L19 7.4" />
  </S>
);

export const IconCopy = (p: P) => (
  <S {...p}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
    <path d="M15.5 5.5A2 2 0 0 0 13.5 4h-6a4 4 0 0 0-4 4v6a2 2 0 0 0 1.5 1.94" />
  </S>
);

export const IconDownload = (p: P) => (
  <S {...p}>
    <path d="M12 3.8v10.4" />
    <path d="M7.8 10.4 12 14.6l4.2-4.2" />
    <path d="M4.5 17.5v1.2a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-1.2" />
  </S>
);

export const IconFileSpreadsheet = (p: P) => (
  <S {...p}>
    <path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5L14 3.5z" />
    <path d="M14 3.5V8.5H19" />
    <path d="M8.5 12.4h7M8.5 15.4h7M11.5 12.4v5" />
  </S>
);

export const IconRefresh = (p: P) => (
  <S {...p}>
    <path d="M20 11.5A8 8 0 0 0 6.2 6.6L4 8.8" />
    <path d="M4 4.4v4.4h4.4" />
    <path d="M4 12.5a8 8 0 0 0 13.8 4.9L20 15.2" />
    <path d="M20 19.6v-4.4h-4.4" />
  </S>
);

export const IconGlobe = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M3.6 12h16.8" />
    <path d="M12 3.4c2.2 2.4 3.3 5.3 3.3 8.6s-1.1 6.2-3.3 8.6c-2.2-2.4-3.3-5.3-3.3-8.6S9.8 5.8 12 3.4z" />
  </S>
);

export const IconClose = (p: P) => (
  <S {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </S>
);

export const IconAlert = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.8v5" />
    <path d="M12 16h.01" />
  </S>
);

export const IconTable = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17M9.5 9.5v10M15 9.5v10" />
  </S>
);

export const IconChart = (p: P) => (
  <S {...p}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M8 20v-6M12.6 20V8.5M17.2 20v-9" />
  </S>
);

export const IconCode = (p: P) => (
  <S {...p}>
    <path d="M9 7.5 4.5 12 9 16.5" />
    <path d="M15 7.5 19.5 12 15 16.5" />
    <path d="M13.5 4.5l-3 15" />
  </S>
);

export const IconLayers = (p: P) => (
  <S {...p}>
    <path d="M12 3.6 3.8 8l8.2 4.4L20.2 8 12 3.6z" />
    <path d="M3.8 12.6 12 17l8.2-4.4" />
    <path d="M3.8 16.8 12 21.2l8.2-4.4" />
  </S>
);

export const IconSidebarCollapse = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" />
    <path d="M9.4 4.5v15" />
    <path d="M17.6 9.6 14.9 12l2.7 2.4" />
  </S>
);

export const IconSidebarExpand = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" />
    <path d="M9.4 4.5v15" />
    <path d="M13.9 9.6 16.6 12l-2.7 2.4" />
  </S>
);

export const IconChartBar = (p: P) => (
  <S {...p}>
    <path d="M4 20h16" />
    <path d="M7.2 20v-5.6M12 20V7.4M16.8 20v-8.8" />
  </S>
);

export const IconChartLine = (p: P) => (
  <S {...p}>
    <path d="M4 20h16" />
    <path d="M5.6 15.8 10 10.2l3.6 2.9L18.8 6.6" />
  </S>
);

export const IconChartPie = (p: P) => (
  <S {...p}>
    <path d="M12 3.9a8.1 8.1 0 1 0 8.1 8.1H12V3.9z" />
    <path d="M14.7 3.9a8.1 8.1 0 0 1 5.4 5.4h-5.4V3.9z" />
  </S>
);

export const IconArrowRight = (p: P) => (
  <S {...p}>
    <path d="M5 12h13.5" />
    <path d="M13 6.5 18.5 12 13 17.5" />
  </S>
);

export const IconThumbUp = (p: P) => (
  <S {...p}>
    <path d="M7 20V10.5l3.6-6a1.7 1.7 0 0 1 3.2 1.1L13 9.5h5.1a1.9 1.9 0 0 1 1.86 2.3l-1.2 6A1.9 1.9 0 0 1 16.9 20H7z" />
    <path d="M7 10.5H4.8a.8.8 0 0 0-.8.8v7.9a.8.8 0 0 0 .8.8H7" />
  </S>
);

export const IconThumbDown = (p: P) => (
  <S {...p}>
    <path d="M17 4v9.5l-3.6 6a1.7 1.7 0 0 1-3.2-1.1L11 14.5H5.9a1.9 1.9 0 0 1-1.86-2.3l1.2-6A1.9 1.9 0 0 1 7.1 4H17z" />
    <path d="M17 13.5h2.2a.8.8 0 0 0 .8-.8V4.8a.8.8 0 0 0-.8-.8H17" />
  </S>
);

export const IconLoader = (p: P) => (
  <S {...p}>
    <path d="M12 3.6a8.4 8.4 0 1 0 8.4 8.4" />
  </S>
);

export const IconUser = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="8.6" r="3.9" />
    <path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0" />
  </S>
);

export const IconRobot = (p: P) => (
  <S {...p}>
    <rect x="3.8" y="7.6" width="16.4" height="11.6" rx="4" />
    <path d="M12 3.4v4.2" />
    <circle cx="12" cy="3.1" r="1.1" />
    <path d="M9 12.4h.01M15 12.4h.01" />
    <path d="M9.6 15.6h4.8" />
  </S>
);

export const IconLogo = (p: P) => (
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...p}>
    <rect width="32" height="32" rx="9" fill="url(#logoGrad)" />
    <path
      d="M10 19.6c0-4.3 6-9.6 6-9.6s6 5.3 6 9.6a6 6 0 1 1-12 0z"
      fill="#fff"
      fillOpacity="0.94"
    />
    <circle cx="16" cy="19.4" r="2.1" fill="#2563eb" />
    <defs>
      <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32">
        <stop stopColor="#3b74f0" />
        <stop offset="1" stopColor="#1d4ed8" />
      </linearGradient>
    </defs>
  </svg>
);
