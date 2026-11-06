import type { ReactNode } from 'react';
import type { ItemId } from '../../../shared/protocol.ts';

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ITEM_PATHS: Record<ItemId, ReactNode> = {
  coffee: (
    <>
      <path d="M4 9h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V9Z" />
      <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3c-1 1.2 1 1.8 0 3M12.5 3c-1 1.2 1 1.8 0 3" />
    </>
  ),
  norminette: (
    <>
      <path d="m3 16 13-13 5 5L8 21l-5-5Z" />
      <path d="m7 12 2 2M10.5 8.5l2 2M14 5l2 2" />
    </>
  ),
  segfault: <path d="m12 2 2.2 5.6L20 5l-2.2 5.8L23 13l-5.6 1.4L19 21l-6-3.2L9 22l-.8-6L2 14.6l5-2.8L4 6l5.6 1.8L12 2Z" />,
  leak: (
    <>
      <path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 1 1-13 0C5.500 10 12 3 12 3Z" />
      <path d="M9 15a3 3 0 0 0 3 3" />
    </>
  ),
  moulinette: <path d="M13.500 2 4 14h7l-1.500 8L20 10h-7l.5-8Z" />,
  duck: (
    <>
      <path d="M8 13a4.500 4.500 0 1 1 8.300-2.400L20 11l-3.200 2c1 4-1.800 8-6.800 8-3.800 0-6.500-2.200-7-6 2 .6 3.500.4 5-2Z" />
      <circle cx="12.500" cy="8.800" r=".6" fill="currentColor" />
    </>
  ),
};

export const ItemIcon = ({ item, size }: { item: ItemId; size?: number }) => <Svg size={size}>{ITEM_PATHS[item]}</Svg>;

export const Icon = {
  Copy: () => <Svg size={16}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>,
  Sound: () => <Svg size={18}><path d="M4 10v4h3l5 4V6L7 10H4ZM16 9a4 4 0 0 1 0 6M18.500 6.500a8 8 0 0 1 0 11" /></Svg>,
  Mute: () => <Svg size={18}><path d="M4 10v4h3l5 4V6L7 10H4ZM16 9.500l5 5M21 9.500l-5 5" /></Svg>,
  Gear: () => <Svg size={18}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900 7 7M17 17l2.100 2.100M4.900 19.100 7 17M17 7l2.100-2.100" /></Svg>,
  Tv: () => <Svg size={18}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="m8 2 4 4 4-4" /></Svg>,
  Drone: () => <Svg size={18}><circle cx="5" cy="6" r="2.500" /><circle cx="19" cy="6" r="2.500" /><circle cx="5" cy="18" r="2.500" /><circle cx="19" cy="18" r="2.500" /><rect x="9.500" y="9.500" width="5" height="5" rx="1" /><path d="m7 8 2.500 2M17 8l-2.500 2M7 16l2.500-2M17 16l-2.500-2" /></Svg>,
  Chase: () => <Svg size={18}><path d="M4 16h16M6 16l2-6h8l2 6M7 19.500h.01M17 19.500h.01M12 3v4" /></Svg>,
  Horn: () => <Svg size={20}><path d="M3 10v4h4l9 5V5l-9 5H3ZM19 9.500a3.500 3.500 0 0 1 0 5" /></Svg>,
  Wheel: () => <Svg size={20}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.500" /><path d="M3.500 10.500 9.500 12M20.500 10.500 14.500 12M12 14.500V21" /></Svg>,
  Map: () => <Svg size={20}><rect x="3" y="4" width="6" height="5" rx="1" /><rect x="15" y="4" width="6" height="5" rx="1" /><rect x="15" y="15" width="6" height="5" rx="1" /><path d="M9 6.500h6M6 9v6.500a2 2 0 0 0 2 2h7" /></Svg>,
  Wrench: () => <Svg size={20}><path d="M14.700 6.300a4.500 4.500 0 0 1 5.700 5.700l-2.800-2.800-2.200.6-.6 2.200 2.800 2.800a4.500 4.500 0 0 1-5.700-5.700L4 16.900 7.100 20l7.800-7.900" /></Svg>,
  Close: () => <Svg size={18}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  Check: () => <Svg size={18}><path d="m5 12.500 4.500 4.500L19 7.500" /></Svg>,
  Lock: () => <Svg size={16}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>,
  Team: () => <Svg size={15}><circle cx="9" cy="8" r="3.500" /><path d="M3 20a6 6 0 0 1 12 0M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.500a6 6 0 0 1 3 5.500" /></Svg>,
  Hourglass: () => <Svg size={16}><path d="M6 3h12M6 21h12M7 3c0 6 10 6 10 12v0M17 3c0 6-10 6-10 12M7 21c0-5 3-5.500 5-7 2 1.500 5 2 5 7" /></Svg>,
  Trophy: () => <Svg size={16}><path d="M8 4h8v6a4 4 0 0 1-8 0V4ZM8 6H4c0 3 1.500 5 4 5M16 6h4c0 3-1.500 5-4 5M12 14v4M8 21h8M9.500 18h5" /></Svg>,
  Play: () => <Svg size={16}><path d="M7 4.500v15l12-7.500-12-7.500Z" /></Svg>,
  Hole: () => <Svg size={16}><circle cx="12" cy="12" r="3.500" fill="currentColor" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-18 12 12)" /></Svg>,
};
