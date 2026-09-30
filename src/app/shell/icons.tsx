/**
 * 인라인 SVG 아이콘.
 *
 * 아이콘 폰트나 외부 스프라이트를 쓰지 않는다 — 빌드 CSP가 외부 요청을 막고, 인라인이면
 * `currentColor`로 다크 모드까지 따라온다. 전부 장식이라 기본값은 `aria-hidden`이다.
 */
interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
}

export function CardIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </svg>
  );
}

export function LockIcon({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="4" y="10" width="16" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function ShieldIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6z" />
      <path d="M9 12.2l2.2 2.2L15.5 10" />
    </svg>
  );
}

export function RulerIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7.5 8v3M12 8v4M16.5 8v3" />
    </svg>
  );
}

export function MinusCircleIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function UploadIcon({ size = 26 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 16V4" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function InfoIcon({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </svg>
  );
}

export function AlertIcon({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 4.5l8.5 15H3.5z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function CheckIcon({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.3 12.2l2.5 2.5 4.9-5.2" />
    </svg>
  );
}

export function InboxIcon({ size = 34 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 13l2.5-7h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 13h5l1 2.5h6l1-2.5h5" />
    </svg>
  );
}

export function DownloadIcon({ size = 15 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19h14" />
    </svg>
  );
}

/** 고르는 칸의 갈매기. 열리면 CSS가 뒤집는다. */
export function ChevronIcon({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
}
