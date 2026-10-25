import React from 'react';

export interface Icon3DProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// =========================================================================
// 1. HOME ICON (Figma 3D Glassmorphic House - Peach/Orange Roof, Frosted Body)
// =========================================================================
export function IconHome3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_12px_rgba(223,107,0,0.2)]">
        <defs>
          <linearGradient id={`${iconId}-fg_home_roof`} x1="60" y1="56" x2="160" y2="112" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FBA47F" />
            <stop offset="1" stopColor="#DF6B00" />
          </linearGradient>
        </defs>
        <path d="M78.25 50.36C83.2 45.08 85.68 42.44 88.59 41.51C90.94 40.75 93.46 40.75 95.81 41.51C98.72 42.44 101.2 45.08 106.15 50.36L128.44 74.12C138.18 84.5 143.05 89.69 143.2 94.14C143.31 97.67 141.84 101.07 139.19 103.4C135.84 106.34 128.73 106.34 114.49 106.34H69.91C55.67 106.34 48.56 106.34 45.21 103.4C42.56 101.07 41.08 97.67 41.2 94.14C41.35 89.69 46.22 84.5 55.96 74.12L78.25 50.36Z" fill={`url(#${iconId}-fg_home_roof)`} />
        <rect x="50" y="80.3" width="83.39" height="64.39" rx="19.28" fill="#F8B77B" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="80.3" y="103.9" width="23.12" height="17.22" rx="8.61" fill="white" fillOpacity="0.95" />
      </svg>
    </div>
  );
}

// =========================================================================
// 2. WALLET ICON (Figma 3D Glassmorphic Wallet - Sapphire Blue, Frosted Pocket)
// =========================================================================
export function IconWallet3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(64,136,244,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_wallet_bg`} x1="68" y1="65" x2="130" y2="84" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7FC0FB" />
            <stop offset="1" stopColor="#4088F4" />
          </linearGradient>
        </defs>
        <rect x="46" y="46.5" width="78.34" height="84.87" rx="19.59" fill={`url(#${iconId}-fg_wallet_bg)`} />
        <rect x="46.3" y="66.4" width="90.79" height="71.2" rx="19.28" fill="#B9DDFF" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="104.7" y="85.7" width="39.17" height="26.11" rx="8.16" fill={`url(#${iconId}-fg_wallet_bg)`} />
        <circle cx="131" cy="98.7" r="6.53" fill="white" />
      </svg>
    </div>
  );
}

// =========================================================================
// 3. SECURITY / SHIELD ICON (Figma 3D Glassmorphic Shield - Mint Green)
// =========================================================================
export function IconSecurity3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(52,146,86,0.2)]">
        <defs>
          <linearGradient id={`${iconId}-fg_shield_bg`} x1="71" y1="61" x2="151" y2="122" gradientUnits="userSpaceOnUse">
            <stop stopColor="#75EDA1" />
            <stop offset="1" stopColor="#349256" />
          </linearGradient>
        </defs>
        <path d="M93.4 116.3C100.3 113.7 127.5 100.6 128.7 56.7C128.7 54.8 127.8 53.1 126.2 52.1C105.1 39 78.5 39 57.4 52.1C55.8 53.1 54.9 54.8 54.9 56.7C56.1 100.6 83.3 113.7 90.2 116.3C91.2 116.7 92.4 116.7 93.4 116.3Z" fill={`url(#${iconId}-fg_shield_bg)`} />
        <path d="M55.3 67.7C77.9 54.8 105.7 54.8 128.3 67.7L131.6 69.6C133.4 70.6 134.6 72.6 134.5 74.7C133.7 98.4 125.2 113.7 116 123.3C106.8 132.9 96.8 136.9 93.2 138.1C92.3 138.4 91.3 138.4 90.4 138.1C86.8 136.9 76.8 132.9 67.6 123.3C58.4 113.7 49.9 98.4 49.1 74.7C49 72.6 50.1 70.6 52 69.6L55.3 67.7Z" fill="#6AE092" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <path d="M107.2 83.4L88.7 101.7L73.3 89.4" stroke="white" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// =========================================================================
// 4. PROFILE ICON (Figma 3D Glassmorphic User Avatar - Violet/Lavender)
// =========================================================================
export function IconProfile3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(63,45,175,0.2)]">
        <defs>
          <linearGradient id={`${iconId}-fg_profile_bg`} x1="72" y1="82" x2="120" y2="122" gradientUnits="userSpaceOnUse">
            <stop stopColor="#917FFB" />
            <stop offset="1" stopColor="#3F2DAF" />
          </linearGradient>
        </defs>
        <path d="M49.5 90C50.5 84.8 51 82.2 52.2 80.2C53.8 77.5 56.2 75.5 59.2 74.5C61.4 73.7 64 73.7 69.2 73.7H114.1C119.3 73.7 121.9 73.7 124.1 74.5C127 75.5 129.5 77.5 131.1 80.2C132.2 82.2 132.7 84.8 133.7 90C135.1 97.3 135.9 100.9 135.1 103.8C134.1 107.7 131.5 110.9 127.9 112.6C125.2 113.9 121.5 113.9 114.1 113.9H69.2C61.8 113.9 58.1 113.9 55.4 112.6C51.8 110.9 49.1 107.7 48.1 103.8C47.4 100.9 48.1 97.3 49.5 90Z" fill={`url(#${iconId}-fg_profile_bg)`} />
        <circle cx="92.2" cy="65.7" r="25" fill="#BFB5FF" fillOpacity="0.85" stroke="white" strokeWidth="1.5" />
        <path d="M70.9 144.1L112.5 144.1C123.8 144.1 133 134.9 133 123.6C133 108.5 120.7 96.2 105.5 96.2H77.8C62.7 96.2 50.4 108.5 50.4 123.6C50.4 134.9 59.6 144.1 70.9 144.1Z" fill="#BFB5FF" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// =========================================================================
// 5. NOTIFICATION ICON (Figma 3D Glassmorphic Bell - Mint Green)
// =========================================================================
export function IconNotification3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(52,146,86,0.2)]">
        <defs>
          <linearGradient id={`${iconId}-fg_notif_clapper`} x1="77" y1="111" x2="128" y2="155" gradientUnits="userSpaceOnUse">
            <stop stopColor="#75EDA1" />
            <stop offset="1" stopColor="#349256" />
          </linearGradient>
        </defs>
        <circle cx="92.2" cy="119.5" r="26.1" fill={`url(#${iconId}-fg_notif_clapper)`} />
        <path fillRule="evenodd" clipRule="evenodd" d="M78.8 50.1C78.8 42.7 84.8 36.7 92.2 36.7C99.6 36.7 105.6 42.7 105.6 50.1C105.6 53.6 104.3 56.7 102.2 59.1C116.3 62.3 126.8 74 128.4 88.4L130.7 109C130.8 109.5 130.8 110 130.8 110.5H131.9C135.9 110.5 139.1 113.7 139.1 117.7C139.1 121.2 136.5 124.3 133 124.7C102.4 128.9 82.7 128.9 51.4 124.7C47.9 124.3 45.3 121.2 45.3 117.7C45.3 113.7 48.5 110.5 52.5 110.5H53.6C53.6 110 53.7 109.5 53.7 109L56 88.4C57.6 74 68.2 62.3 82.2 59.1C80.1 56.7 78.8 53.6 78.8 50.1Z" fill="#6AE092" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// =========================================================================
// 6. CALENDAR ICON (Figma 3D Glassmorphic Calendar - Crimson Red & Pink)
// =========================================================================
export function IconCalendar3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(245,40,40,0.2)]">
        <defs>
          <linearGradient id={`${iconId}-fg_cal_bg`} x1="36" y1="59" x2="65" y2="87" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF6161" />
            <stop offset="1" stopColor="#F52828" />
          </linearGradient>
        </defs>
        <path d="M45.6 74.5C45.6 68.7 45.6 65.8 46.5 63.5C47.8 60 50.6 57.2 54.1 55.9C56.4 55 59.3 55 65.1 55H119.1C124.9 55 127.8 55 130.1 55.9C133.6 57.2 136.4 60 137.7 63.5C138.6 65.8 138.6 68.7 138.6 74.5V103.2H45.6V74.5Z" fill={`url(#${iconId}-fg_cal_bg)`} />
        <rect x="59.2" y="40.7" width="19.35" height="26" rx="9.67" fill="#FFB7B5" fillOpacity="0.85" stroke="white" strokeWidth="1.2" />
        <rect x="105.8" y="40.7" width="19.35" height="26" rx="9.67" fill="#FFB7B5" fillOpacity="0.85" stroke="white" strokeWidth="1.2" />
        <path d="M66.9 73.9H117.4C121.2 73.9 123.9 73.9 126.1 74.1C128.3 74.3 129.9 74.7 131.3 75.4C133.7 76.6 135.7 78.6 137 81.1C137.7 82.4 138 84 138.2 86.2C138.4 88.4 138.4 91.2 138.4 94.9V108.2C138.4 113.8 138.4 118 138.1 121.3C137.8 124.6 137.3 127 136.2 129.1C134.4 132.8 131.4 135.8 127.7 137.7C125.6 138.8 123.2 139.3 119.9 139.6C116.6 139.8 112.4 139.9 106.8 139.9H77.5C71.9 139.9 67.8 139.8 64.4 139.6C61.1 139.3 58.7 138.8 56.6 137.7C52.9 135.8 49.9 132.8 48 129.1C47 127 46.4 124.6 46.2 121.3C45.9 118 45.9 113.8 45.9 108.2V94.9C45.9 91.2 45.9 88.4 46.1 86.2C46.3 84 46.6 82.4 47.3 81.1C48.6 78.6 50.6 76.6 53 75.4C54.4 74.7 56 74.3 58.2 74.1C60.4 73.9 63.2 73.9 66.9 73.9Z" fill="#FFB7B5" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="72.4" y="93.8" width="39.4" height="6.16" rx="3.08" fill="white" />
        <rect x="72.4" y="113.8" width="39.4" height="6.16" rx="3.08" fill="white" />
      </svg>
    </div>
  );
}

// =========================================================================
// 7. MESSAGE / ENVELOPE ICON (Figma 3D Glassmorphic Message - Royal Blue)
// =========================================================================
export function IconMessage3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(64,136,244,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_msg_bg`} x1="72" y1="71" x2="142" y2="97" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7FC0FB" />
            <stop offset="1" stopColor="#4088F4" />
          </linearGradient>
        </defs>
        <path d="M45.3 85.8C45.3 76.2 45.3 71.3 48 67.8C50.7 64.2 55.3 62.9 64.6 60.3L80.9 55.6C86.3 54.1 89.1 53.3 91.9 53.3C94.7 53.3 97.4 54.1 102.8 55.6L119.1 60.3C128.4 62.9 133 64.2 135.7 67.8C138.4 71.3 138.4 76.2 138.4 85.8V99C138.4 117.8 138.4 127.2 132.6 133.1C126.7 138.9 117.3 138.9 98.5 138.9H85.2C66.4 138.9 57 138.9 51.1 133.1C45.3 127.2 45.3 117.8 45.3 99V85.8Z" fill={`url(#${iconId}-fg_msg_bg)`} />
        <path d="M61.9 39.5H121.8C124.4 39.5 126.8 40.9 128.6 43.4C130.4 45.8 131.5 49.2 131.5 52.9V82.9C121.8 90.3 114.4 97.6 108.2 103C105.1 105.8 102.2 108 99.6 109.6C96.9 111.2 94.4 112 91.9 112C89.4 112 87 111.1 84.3 109.6C81.6 108 78.8 105.7 75.7 103C69.4 97.6 62 90.3 52.3 82.9V52.9C52.3 49.2 53.4 45.8 55.1 43.4C56.9 40.9 59.3 39.5 61.9 39.5Z" fill="#B9DDFF" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="73.6" y="59.4" width="39.4" height="6.16" rx="3.08" fill="white" />
        <rect x="73.6" y="79.3" width="39.4" height="6.16" rx="3.08" fill="white" />
      </svg>
    </div>
  );
}
export const IconChat3D = IconMessage3D;

// =========================================================================
// 8. LOCATION ICON (Figma 3D Glassmorphic Map Pin - Coral Red)
// =========================================================================
export function IconLocation3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(245,40,40,0.2)]">
        <defs>
          <linearGradient id={`${iconId}-fg_loc_bg`} x1="64" y1="130" x2="123" y2="175" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF6161" />
            <stop offset="1" stopColor="#F52828" />
          </linearGradient>
        </defs>
        <path d="M52.9 116.4C54.1 109.1 54.7 105.4 56.8 102.8C57.7 101.7 58.8 100.8 60.1 100C63 98.4 66.7 98.4 74.1 98.4H109.4C116.8 98.4 120.6 98.4 123.4 100C124.7 100.8 125.8 101.7 126.7 102.8C128.8 105.4 129.4 109.1 130.7 116.4C132.3 126.3 133.1 131.2 131.2 134.9C130.4 136.5 129.2 137.9 127.8 139C124.5 141.5 119.5 141.5 109.4 141.5H74.1C64.1 141.5 59.1 141.5 55.8 139C54.4 137.9 53.2 136.5 52.4 134.9C50.4 131.2 51.3 126.3 52.9 116.4Z" fill={`url(#${iconId}-fg_loc_bg)`} />
        <path d="M91.8 37.1C108.6 37.1 122.3 51.6 122.3 69.6C122.3 78.6 118.8 91.9 113.3 102.9C110.5 108.4 107.2 113.4 103.6 116.9C99.9 120.5 95.9 122.6 91.8 122.6C87.7 122.6 83.7 120.5 80.1 116.9C76.4 113.4 73.1 108.4 70.4 102.9C64.8 91.9 61.4 78.6 61.4 69.6C61.4 51.6 75 37.1 91.8 37.1Z" fill="#FFB7B5" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <circle cx="91.8" cy="67.6" r="12" fill="white" />
      </svg>
    </div>
  );
}

// =========================================================================
// 9. ELECTRICITY & WATER / METER ICON (Figma 3D Glassmorphic Golden Lightning & Sky-Blue Water Droplet)
// =========================================================================
export function IconElectricity3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(245,158,11,0.28)]">
        <defs>
          <linearGradient id={`${iconId}-fg_el_depth`} x1="60" y1="30" x2="130" y2="160" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#D97706" />
            <stop offset="100%" stopColor="#B45309" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_el_gold`} x1="70" y1="28" x2="115" y2="155" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FDE047" />
            <stop offset="50%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_el_glass`} x1="75" y1="35" x2="110" y2="145" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FEF9C3" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#FDE047" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <path d="M107 26L61 92H89L73 158L123 82H95L107 26Z" fill={`url(#${iconId}-fg_el_depth)`} />
        <path d="M107 26L113 32L101 88H129L79 164L73 158L123 82H95L107 26Z" fill="#92400E" opacity="0.6" />
        <path d="M104 28L58 94H86L70 160L120 84H92L104 28Z" fill={`url(#${iconId}-fg_el_depth)`} />
        <path d="M101 30L55 96H83L67 162L117 86H89L101 30Z" fill={`url(#${iconId}-fg_el_gold)`} />
        <path d="M99 34L59 94H85L71 154L113 88H89L99 34Z" fill={`url(#${iconId}-fg_el_glass)`} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M97 38L65 92H83L77 114L93 88H89L97 38Z" fill="white" fillOpacity="0.85" />
        <ellipse cx="88" cy="74" rx="3.5" ry="12" transform="rotate(-30 88 74)" fill="white" fillOpacity="0.9" />
        <circle cx="73" cy="148" r="2" fill="white" fillOpacity="0.95" />
      </svg>
    </div>
  );
}

export function IconWater3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(2,132,199,0.25)]">
        <defs>
          <linearGradient id={`${iconId}-fg_wt_base`} x1="50" y1="40" x2="130" y2="160" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0284C7" />
            <stop offset="100%" stopColor="#0369A1" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_wt_core`} x1="60" y1="50" x2="110" y2="150" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="60%" stopColor="#0284C7" />
            <stop offset="100%" stopColor="#0369A1" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_wt_glass`} x1="70" y1="60" x2="100" y2="140" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#BAE6FD" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.75" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_wt_accent`} x1="110" y1="35" x2="145" y2="95" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7DD3FC" />
            <stop offset="100%" stopColor="#0284C7" />
          </linearGradient>
        </defs>
        <path d="M128 36C128 36 148 68 148 84C148 95.0457 139.046 104 128 104C116.954 104 108 95.0457 108 84C108 68 128 36 128 36Z" fill="#0369A1" opacity="0.35" transform="translate(2, 3)" />
        <path d="M128 36C128 36 148 68 148 84C148 95.0457 139.046 104 128 104C116.954 104 108 95.0457 108 84C108 68 128 36 128 36Z" fill={`url(#${iconId}-fg_wt_accent)`} />
        <path d="M128 42C128 42 144 70 144 83C144 92 137 99 128 99C119 99 112 92 112 83C112 70 128 42 128 42Z" fill="#BAE6FD" fillOpacity="0.65" stroke="white" strokeWidth="1.2" />
        <ellipse cx="121" cy="74" rx="3" ry="8" transform="rotate(-30 121 74)" fill="white" fillOpacity="0.9" />
        <path d="M80 50C80 50 116 98 116 120C116 139.882 99.8823 156 80 156C60.1177 156 44 139.882 44 120C44 98 80 50 80 50Z" fill="#0284C7" opacity="0.4" transform="translate(3, 4)" />
        <path d="M80 50C80 50 116 98 116 120C116 139.882 99.8823 156 80 156C60.1177 156 44 139.882 44 120C44 98 80 50 80 50Z" fill={`url(#${iconId}-fg_wt_base)`} />
        <path d="M80 52C80 52 114 98 114 119C114 137.778 98.7777 153 80 153C61.2223 153 46 137.778 46 119C46 98 80 52 80 52Z" fill={`url(#${iconId}-fg_wt_core)`} />
        <path d="M80 56C80 56 110 99 110 118C110 134.569 96.5685 148 80 148C63.4315 148 50 134.569 50 118C50 99 80 56 80 56Z" fill={`url(#${iconId}-fg_wt_glass)`} stroke="white" strokeWidth="1.5" />
        <path d="M68 84C62 94 60 106 60 118C60 120 62 120 63 118C67 106 72 96 78 86C79 84 78 82 76 82C73 82 70 83 68 84Z" fill="white" fillOpacity="0.85" />
        <ellipse cx="68" cy="100" rx="4.5" ry="14" transform="rotate(-25 68 100)" fill="white" fillOpacity="0.95" />
        <ellipse cx="73" cy="80" rx="3" ry="5" transform="rotate(-20 73 80)" fill="white" fillOpacity="0.8" />
        <path d="M64 136C70 142 90 142 96 136C92 140 78 143 64 136Z" fill="#38BDF8" opacity="0.9" />
      </svg>
    </div>
  );
}

export function IconMeter3D({ size = 48, className = '', style }: Icon3DProps) {
  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <IconElectricity3D size={Math.round(size * 0.72)} className="absolute left-0 top-0 -rotate-6" />
      <IconWater3D size={Math.round(size * 0.72)} className="absolute right-0 bottom-0" />
    </div>
  );
}

// =========================================================================
// 10. LOCK / PASSWORD ICON (Figma 3D Glassmorphic Padlock - Coral Red)
// =========================================================================
export function IconLock3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(245,40,40,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_lock_shackle`} x1="72" y1="36" x2="112" y2="74" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF6161" />
            <stop offset="1" stopColor="#DC2626" />
          </linearGradient>
        </defs>
        <path d="M72 74V56C72 44.95 80.95 36 92 36C103.05 36 112 44.95 112 56V74" stroke={`url(#${iconId}-fg_lock_shackle)`} strokeWidth="14" strokeLinecap="round" />
        <rect x="52" y="72" width="80" height="66" rx="20" fill="#FFB7B5" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="86" y="90" width="12" height="24" rx="6" fill="white" />
      </svg>
    </div>
  );
}
export const IconKey3D = IconLock3D;

// =========================================================================
// 11. MAGNIFIER / SEARCH ICON (Figma 3D Glassmorphic Magnifier - Mint Green)
// =========================================================================
export function IconMagnifier3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(16,185,129,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_mag_handle`} x1="40" y1="130" x2="70" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#10B981" />
            <stop offset="1" stopColor="#059669" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_mag_ring`} x1="60" y1="50" x2="130" y2="110" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6EE7B7" />
            <stop offset="1" stopColor="#10B981" />
          </linearGradient>
        </defs>
        <path d="M66 108L44 130" stroke={`url(#${iconId}-fg_mag_handle)`} strokeWidth="16" strokeLinecap="round" />
        <circle cx="96" cy="78" r="34" fill="#A7F3D0" fillOpacity="0.55" stroke={`url(#${iconId}-fg_mag_ring)`} strokeWidth="8" />
        <ellipse cx="86" cy="68" rx="10" ry="5" transform="rotate(-30 86 68)" fill="white" fillOpacity="0.85" />
      </svg>
    </div>
  );
}
export const IconSearchPlate3D = IconMagnifier3D;

// =========================================================================
// 12. CAMERA ICON (Figma 3D Glassmorphic Camera - Warm Orange)
// =========================================================================
export function IconCamera3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(249,115,22,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_cam_top`} x1="66" y1="52" x2="118" y2="76" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FB923C" />
            <stop offset="1" stopColor="#EA580C" />
          </linearGradient>
        </defs>
        <rect x="66" y="52" width="52" height="30" rx="10" fill={`url(#${iconId}-fg_cam_top)`} />
        <rect x="100" y="66" width="10" height="4" rx="2" fill="white" fillOpacity="0.9" />
        <rect x="50" y="60" width="84" height="64" rx="20" fill="#FDBA74" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <circle cx="92" cy="92" r="18" stroke="white" strokeWidth="5.5" fill="none" opacity="0.9" />
      </svg>
    </div>
  );
}

// =========================================================================
// 13. CART ICON (Figma 3D Glassmorphic Shopping Cart - Orange)
// =========================================================================
export function IconCart3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(249,115,22,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_cart_wheel`} x1="60" y1="110" x2="120" y2="130" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F97316" />
            <stop offset="1" stopColor="#C2410C" />
          </linearGradient>
        </defs>
        <path d="M116 66L126 54C128 52 132 53 134 56C136 59 135 63 132 65L124 72" stroke={`url(#${iconId}-fg_cart_wheel)`} strokeWidth="6" strokeLinecap="round" />
        <path d="M52 64H122C126 64 129 67 128 71L120 102C119 106 116 109 112 109H66C62 109 58 106 57 102L52 64Z" fill="#FED7AA" fillOpacity="0.8" stroke="white" strokeWidth="1.5" />
        <circle cx="68" cy="120" r="10" fill={`url(#${iconId}-fg_cart_wheel)`} />
        <circle cx="108" cy="120" r="10" fill={`url(#${iconId}-fg_cart_wheel)`} />
      </svg>
    </div>
  );
}

// =========================================================================
// 14. FOLDER ICON (Figma 3D Glassmorphic Folder - Azure Blue)
// =========================================================================
export function IconFolder3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(59,130,246,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_folder_back`} x1="50" y1="56" x2="140" y2="128" gradientUnits="userSpaceOnUse">
            <stop stopColor="#60A5FA" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
        </defs>
        <path d="M52 56H84L94 66H132C138 66 142 70 142 76V118C142 124 138 128 132 128H52C46 128 42 124 42 118V66C42 60 46 56 52 56Z" fill={`url(#${iconId}-fg_folder_back)`} />
        <rect x="60" y="60" width="18" height="6" rx="3" fill="white" />
        <path d="M46 76H138L126 128H34L46 76Z" fill="#93C5FD" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// =========================================================================
// 15. PENCIL ICON (Figma 3D Glassmorphic Pencil / Stylus - Lavender Purple)
// =========================================================================
export function IconPencil3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(124,58,237,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_pencil_body`} x1="60" y1="120" x2="130" y2="50" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8B5CF6" />
            <stop offset="1" stopColor="#6D28D9" />
          </linearGradient>
        </defs>
        <path d="M124 48L136 60L74 122L54 130L62 110L124 48Z" fill={`url(#${iconId}-fg_pencil_body)`} />
        <path d="M116 56L128 68L80 116L68 104L116 56Z" fill="#DDD6FE" fillOpacity="0.8" stroke="white" strokeWidth="1.2" />
        <rect x="114" y="42" width="18" height="10" rx="3" transform="rotate(45 114 42)" fill="white" />
      </svg>
    </div>
  );
}

// =========================================================================
// 16. PICTURE / GALLERY ICON (Figma 3D Glassmorphic Photo Frame - Purple)
// =========================================================================
export function IconPicture3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(139,92,246,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_pic_back`} x1="48" y1="52" x2="124" y2="116" gradientUnits="userSpaceOnUse">
            <stop stopColor="#A78BFA" />
            <stop offset="1" stopColor="#6D28D9" />
          </linearGradient>
        </defs>
        <rect x="48" y="52" width="76" height="64" rx="16" fill={`url(#${iconId}-fg_pic_back)`} />
        <rect x="60" y="64" width="76" height="64" rx="16" fill="#C4B5FD" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <path d="M70 114L86 94L100 108L112 96L126 114H70Z" fill="white" fillOpacity="0.95" />
        <circle cx="112" cy="80" r="7" fill="white" />
      </svg>
    </div>
  );
}

// =========================================================================
// 17. SETTINGS ICON (Figma 3D Glassmorphic Sliders Equalizer - Purple)
// =========================================================================
export function IconSettings3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(124,58,237,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_set_bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A78BFA" />
            <stop offset="100%" stopColor="#6D28D9" />
          </linearGradient>
        </defs>
        <rect x="62" y="50" width="8" height="84" rx="4" fill={`url(#${iconId}-fg_set_bar)`} />
        <rect x="88" y="50" width="8" height="84" rx="4" fill={`url(#${iconId}-fg_set_bar)`} />
        <rect x="114" y="50" width="8" height="84" rx="4" fill={`url(#${iconId}-fg_set_bar)`} />
        <circle cx="66" cy="100" r="14" fill="#C4B5FD" fillOpacity="0.85" stroke="white" strokeWidth="1.5" />
        <circle cx="92" cy="70" r="14" fill="#C4B5FD" fillOpacity="0.85" stroke="white" strokeWidth="1.5" />
        <circle cx="118" cy="108" r="14" fill="#C4B5FD" fillOpacity="0.85" stroke="white" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// =========================================================================
// 18. SHARE ICON (Figma 3D Glassmorphic Connected Nodes - Blue)
// =========================================================================
export function IconShare3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(37,99,235,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_share_line`} x1="70" y1="60" x2="120" y2="120" gradientUnits="userSpaceOnUse">
            <stop stopColor="#60A5FA" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
        </defs>
        <path d="M76 88L110 68" stroke={`url(#${iconId}-fg_share_line)`} strokeWidth="8" strokeLinecap="round" />
        <path d="M76 96L110 116" stroke={`url(#${iconId}-fg_share_line)`} strokeWidth="8" strokeLinecap="round" />
        <circle cx="70" cy="92" r="16" fill="#93C5FD" fillOpacity="0.85" stroke="white" strokeWidth="1.5" />
        <circle cx="116" cy="62" r="16" fill="#93C5FD" fillOpacity="0.85" stroke="white" strokeWidth="1.5" />
        <circle cx="116" cy="122" r="16" fill="#93C5FD" fillOpacity="0.85" stroke="white" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// =========================================================================
// 19. SUITCASE ICON (Figma 3D Glassmorphic Briefcase - Orange)
// =========================================================================
export function IconSuitcase3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(249,115,22,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_suit_handle`} x1="74" y1="40" x2="110" y2="60" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F97316" />
            <stop offset="1" stopColor="#C2410C" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_suit_top`} x1="50" y1="56" x2="134" y2="88" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FB923C" />
            <stop offset="1" stopColor="#EA580C" />
          </linearGradient>
        </defs>
        <path d="M74 60V48C74 43.6 77.6 40 82 40H102C106.4 40 110 43.6 110 48V60" stroke={`url(#${iconId}-fg_suit_handle)`} strokeWidth="8" strokeLinecap="round" />
        <path d="M50 68C50 61.4 55.4 56 62 56H122C128.6 56 134 61.4 134 68V88H50V68Z" fill={`url(#${iconId}-fg_suit_top)`} />
        <path d="M50 84H134V122C134 128.6 128.6 134 122 134H62C55.4 134 50 128.6 50 122V84Z" fill="#FED7AA" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="82" y="80" width="20" height="8" rx="4" fill="white" />
      </svg>
    </div>
  );
}

// =========================================================================
// 20. TRASH / CLEANLINESS ICON (Figma 3D Glassmorphic Bin - Crimson Red)
// =========================================================================
export function IconTrash3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(244,63,94,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_trash_lid`} x1="52" y1="38" x2="132" y2="66" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FB7185" />
            <stop offset="1" stopColor="#E11D48" />
          </linearGradient>
        </defs>
        <path d="M78 46C78 42 81 38 86 38H98C103 38 106 42 106 46" stroke={`url(#${iconId}-fg_trash_lid)`} strokeWidth="8" strokeLinecap="round" />
        <rect x="52" y="48" width="80" height="18" rx="9" fill={`url(#${iconId}-fg_trash_lid)`} />
        <path d="M60 64L68 132C69 138 73 142 79 142H105C111 142 115 138 116 132L124 64H60Z" fill="#FECDD3" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="82" y="78" width="6" height="36" rx="3" fill="white" />
        <rect x="96" y="78" width="6" height="36" rx="3" fill="white" />
      </svg>
    </div>
  );
}
export const IconCleanliness3D = IconTrash3D;

// =========================================================================
// 21. CLOCK ICON (Figma 3D Glassmorphic Clock - Purple/Violet)
// =========================================================================
export function IconClock3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(124,58,237,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_clk_bg`} x1="50" y1="40" x2="120" y2="110" gradientUnits="userSpaceOnUse">
            <stop stopColor="#A78BFA" />
            <stop offset="1" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        <circle cx="82" cy="74" r="38" fill={`url(#${iconId}-fg_clk_bg)`} />
        <circle cx="94" cy="94" r="46" fill="#DDD6FE" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <path d="M94 66V94H116" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// =========================================================================
// 22. DANGER / ALERT ICON (Figma 3D Glassmorphic Warning Triangle - Coral Pink)
// =========================================================================
export function IconAlert3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(244,63,94,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_danger_bg`} x1="44" y1="42" x2="136" y2="130" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FB7185" />
            <stop offset="1" stopColor="#E11D48" />
          </linearGradient>
        </defs>
        <path d="M82 42L44 116C41 122 45 130 52 130H128C135 130 139 122 136 116L98 42C95 36 85 36 82 42Z" fill={`url(#${iconId}-fg_danger_bg)`} />
        <path d="M88 48L50 122C47 128 51 136 58 136H134C141 136 145 128 142 122L104 48C101 42 91 42 88 48Z" fill="#FDA4AF" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="93" y="70" width="6" height="24" rx="3" fill="white" />
        <circle cx="96" cy="108" r="4" fill="white" />
      </svg>
    </div>
  );
}

// =========================================================================
// 23. CONTRACT / DOCUMENT ICON (Figma 3D Glassmorphic Sheet - Lavender Purple)
// =========================================================================
export function IconContract3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(124,58,237,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_doc_bg`} x1="46" y1="46" x2="130" y2="142" gradientUnits="userSpaceOnUse">
            <stop stopColor="#A78BFA" />
            <stop offset="1" stopColor="#7C3AED" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_doc_fold`} x1="110" y1="46" x2="130" y2="66" gradientUnits="userSpaceOnUse">
            <stop stopColor="#C4B5FD" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <path d="M56 46H110L130 66V132C130 138 126 142 120 142H56C50 142 46 138 46 132V56C46 50 50 46 56 46Z" fill={`url(#${iconId}-fg_doc_bg)`} />
        <path d="M110 46V66H130Z" fill={`url(#${iconId}-fg_doc_fold)`} />
        <path d="M62 60H112L124 72V136C124 140 120 144 116 144H62C58 144 54 140 54 136V68C54 64 58 60 62 60Z" fill="#DDD6FE" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <rect x="68" y="82" width="44" height="6" rx="3" fill="white" />
        <rect x="68" y="98" width="34" height="6" rx="3" fill="white" />
        <rect x="68" y="114" width="44" height="6" rx="3" fill="white" />
      </svg>
    </div>
  );
}
export const IconDeclaration3D = IconContract3D;
export const IconHandbook3D = IconContract3D;

// =========================================================================
// 24. VEHICLE ICON (Figma 3D Glassmorphic Motorcycle - Transparent Background)
// =========================================================================
export function IconVehicle3D({ size = 48, className = '', style }: Icon3DProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 bg-transparent select-none ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <img
        src="/assets/aistudio/motorcycle_b74bc921.svg"
        alt="Biển số xe"
        width={size}
        height={size}
        className="w-full h-full object-contain pointer-events-none select-none bg-transparent drop-shadow-[0_4px_12px_rgba(239,86,65,0.28)]"
      />
    </div>
  );
}

// =========================================================================
// 25. WIFI ICON (Figma 3D Glassmorphic Wi-Fi Wave - Royal Blue & Sky)
// =========================================================================
export function IconWifi3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(2,132,199,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_wifi_bg`} x1="40" y1="40" x2="140" y2="140" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#0284C7" />
          </linearGradient>
        </defs>
        <circle cx="92" cy="132" r="10" fill={`url(#${iconId}-fg_wifi_bg)`} stroke="white" strokeWidth="1.5" />
        <path d="M68 112C81 99 103 99 116 112" stroke="#38BDF8" strokeWidth="8" strokeLinecap="round" />
        <path d="M52 94C74 72 110 72 132 94" stroke="#0284C7" strokeWidth="8" strokeLinecap="round" />
        <path d="M36 76C67 45 117 45 148 76" stroke={`url(#${iconId}-fg_wifi_bg)`} strokeWidth="8" strokeLinecap="round" />
        <path d="M40 76C70 48 114 48 144 76" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
      </svg>
    </div>
  );
}

// =========================================================================
// 26. MAINTENANCE ICON (Figma 3D Glassmorphic Wrench Tool)
// =========================================================================
export function IconMaintenance3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(249,115,22,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_maint_bg`} x1="40" y1="140" x2="140" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FB923C" />
            <stop offset="1" stopColor="#C2410C" />
          </linearGradient>
        </defs>
        <path d="M128 42C120 42 113 46 109 52L62 118C60 120 60 124 62 126L74 138C76 140 80 140 82 138L129 72C135 68 139 61 139 53C139 47 134 42 128 42Z" fill={`url(#${iconId}-fg_maint_bg)`} />
        <path d="M116 54L68 122L56 110L104 42" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        <circle cx="128" cy="52" r="8" fill="white" />
      </svg>
    </div>
  );
}

// =========================================================================
// 27. SUPPORT / HOTLINE ICON (Figma 3D Glassmorphic Headset)
// =========================================================================
export function IconSupport3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(2,132,199,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_support_bg`} x1="40" y1="40" x2="140" y2="140" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38BDF8" />
            <stop offset="1" stopColor="#0284C7" />
          </linearGradient>
        </defs>
        <path d="M50 96C50 72.8 68.8 54 92 54C115.2 54 134 72.8 134 96V114" stroke={`url(#${iconId}-fg_support_bg)`} strokeWidth="10" strokeLinecap="round" />
        <rect x="42" y="92" width="18" height="32" rx="9" fill="#7DD3FC" stroke="white" strokeWidth="1.5" />
        <rect x="124" y="92" width="18" height="32" rx="9" fill="#7DD3FC" stroke="white" strokeWidth="1.5" />
        <path d="M130 114V128C130 133 126 137 121 137H106" stroke={`url(#${iconId}-fg_support_bg)`} strokeWidth="6" strokeLinecap="round" />
        <circle cx="104" cy="137" r="6" fill="#0284C7" stroke="white" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// =========================================================================
// 28. GUIDE / COMPASS ICON (Figma 3D Glassmorphic Discovery Compass - Coral)
// =========================================================================
export function IconGuide3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(249,115,22,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_guide_bg`} x1="50" y1="40" x2="130" y2="120" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FB923C" />
            <stop offset="1" stopColor="#EA580C" />
          </linearGradient>
        </defs>
        <circle cx="82" cy="74" r="38" fill={`url(#${iconId}-fg_guide_bg)`} />
        <circle cx="94" cy="94" r="46" fill="#FED7AA" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <path d="M112 76L98 94L80 112L94 94L112 76Z" fill="white" />
        <circle cx="94" cy="94" r="4" fill="#EA580C" />
      </svg>
    </div>
  );
}

// =========================================================================
// 29. TICK / SUCCESS ICON (Figma 3D Glassmorphic Checkmark - Mint Green)
// =========================================================================
export function IconTick3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(16,185,129,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_tick_bg`} x1="40" y1="50" x2="140" y2="130" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6EE7B7" />
            <stop offset="1" stopColor="#10B981" />
          </linearGradient>
        </defs>
        <circle cx="82" cy="74" r="38" fill={`url(#${iconId}-fg_tick_bg)`} />
        <circle cx="94" cy="94" r="46" fill="#A7F3D0" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <path d="M76 96L88 108L114 82" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// =========================================================================
// 30. LOGOUT ICON (Figma 3D Glassmorphic Exit Door & Arrow - Crimson Red)
// =========================================================================
export function IconLogout3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(239,68,68,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_logout_bg`} x1="40" y1="40" x2="140" y2="140" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F87171" />
            <stop offset="1" stopColor="#DC2626" />
          </linearGradient>
        </defs>
        <path d="M96 52H60C54 52 50 56 50 62V122C50 128 54 132 60 132H96" stroke={`url(#${iconId}-fg_logout_bg)`} strokeWidth="10" strokeLinecap="round" />
        <rect x="76" y="60" width="56" height="64" rx="14" fill="#FECDD3" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
        <path d="M102 92H136M136 92L124 80M136 92L124 104" stroke="white" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// =========================================================================
// 31. STAR ICON (Figma 3D Glassmorphic Star - Golden Amber)
// =========================================================================
export function IconStar3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(245,158,11,0.25)]">
        <defs>
          <linearGradient id={`${iconId}-fg_star_bg`} x1="40" y1="40" x2="140" y2="140" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FCD34D" />
            <stop offset="1" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        <path d="M92 42L106 72L138 76L114 98L120 130L92 114L64 130L70 98L46 76L78 72L92 42Z" fill={`url(#${iconId}-fg_star_bg)`} />
        <path d="M98 48L112 78L144 82L120 104L126 136L98 120L70 136L76 104L52 82L84 78L98 48Z" fill="#FEF08A" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// =========================================================================
// 32. HEART ICON (Figma 3D Glassmorphic Double Hearts - Rose Pink)
// =========================================================================
export function IconHeart3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_14px_rgba(244,63,94,0.22)]">
        <defs>
          <linearGradient id={`${iconId}-fg_heart_bg`} x1="40" y1="40" x2="140" y2="140" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FB7185" />
            <stop offset="1" stopColor="#E11D48" />
          </linearGradient>
        </defs>
        <path d="M92 64C82 50 64 50 54 60C44 70 44 88 56 100L92 134L128 100C140 88 140 70 130 60C120 50 102 50 92 64Z" fill={`url(#${iconId}-fg_heart_bg)`} />
        <path d="M100 70C90 56 72 56 62 66C52 76 52 94 64 106L100 140L136 106C148 94 148 76 138 66C128 56 110 56 100 70Z" fill="#FECDD3" fillOpacity="0.75" stroke="white" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// =========================================================================
// LAUNDRY ICON (Simplified Modern 3D Glassmorphic Washing Machine)
// =========================================================================
export function IconLaundry3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_16px_rgba(2,132,199,0.24)]">
        <defs>
          <linearGradient id={`${iconId}-fg_laundry_simp_body`} x1="42" y1="36" x2="142" y2="148" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38BDF8" />
            <stop offset="1" stopColor="#0284C7" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_laundry_simp_drum`} x1="68" y1="78" x2="116" y2="132" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0284C7" />
            <stop offset="1" stopColor="#075985" />
          </linearGradient>
        </defs>

        {/* 1. Main Rounded Body */}
        <rect x="42" y="36" width="100" height="112" rx="26" fill={`url(#${iconId}-fg_laundry_simp_body)`} />

        {/* 2. Frosted Glass Front Face */}
        <rect x="46" y="40" width="92" height="104" rx="22" fill="#BAE6FD" fillOpacity="0.75" stroke="white" strokeWidth="2" />

        {/* 3. Minimalist Top Control Panel */}
        <rect x="58" y="52" width="34" height="6" rx="3" fill="white" fillOpacity="0.95" />
        <circle cx="118" cy="55" r="5" fill="#0284C7" stroke="white" strokeWidth="1.5" />
        <circle cx="120" cy="53.5" r="1.2" fill="white" />

        {/* 4. Large Circular Glass Door */}
        <circle cx="92" cy="103" r="32" fill="white" fillOpacity="0.95" />
        <circle cx="92" cy="103" r="26" fill={`url(#${iconId}-fg_laundry_simp_drum)`} />

        {/* 5. Minimalist Water Swirl */}
        <path d="M75 107C81 97 89 97 95 105C101 113 107 111 111 105" stroke="#38BDF8" strokeWidth="4" strokeLinecap="round" fill="none" />
        <circle cx="95" cy="94" r="2.5" fill="white" fillOpacity="0.85" />

        {/* 6. Curved Glass Highlight */}
        <path d="M78 91C84 83 98 83 106 91" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
      </svg>
    </div>
  );
}

// =========================================================================
// DRYER ICON (Simplified Modern 3D Glassmorphic Clothes Dryer)
// =========================================================================
export function IconDryer3D({ size = 48, className = '', style }: Icon3DProps) {
  const iconId = React.useId().replace(/:/g, "");
  return (
    <div className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_16px_rgba(234,88,12,0.24)]">
        <defs>
          <linearGradient id={`${iconId}-fg_dryer_simp_body`} x1="42" y1="36" x2="142" y2="148" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FB923C" />
            <stop offset="1" stopColor="#EA580C" />
          </linearGradient>
          <linearGradient id={`${iconId}-fg_dryer_simp_drum`} x1="68" y1="78" x2="116" y2="132" gradientUnits="userSpaceOnUse">
            <stop stopColor="#EA580C" />
            <stop offset="1" stopColor="#9A3412" />
          </linearGradient>
        </defs>

        {/* 1. Main Rounded Body */}
        <rect x="42" y="36" width="100" height="112" rx="26" fill={`url(#${iconId}-fg_dryer_simp_body)`} />

        {/* 2. Frosted Glass Front Face */}
        <rect x="46" y="40" width="92" height="104" rx="22" fill="#FED7AA" fillOpacity="0.75" stroke="white" strokeWidth="2" />

        {/* 3. Minimalist Top Control Panel */}
        <rect x="58" y="52" width="34" height="6" rx="3" fill="white" fillOpacity="0.95" />
        <circle cx="118" cy="55" r="5" fill="#EA580C" stroke="white" strokeWidth="1.5" />
        <circle cx="120" cy="53.5" r="1.2" fill="white" />

        {/* 4. Large Circular Glass Door */}
        <circle cx="92" cy="103" r="32" fill="white" fillOpacity="0.95" />
        <circle cx="92" cy="103" r="26" fill={`url(#${iconId}-fg_dryer_simp_drum)`} />

        {/* 5. Minimalist Heat Wave */}
        <path d="M75 107C81 97 89 97 95 105C101 113 107 111 111 105" stroke="#FDE047" strokeWidth="4" strokeLinecap="round" fill="none" />
        <circle cx="95" cy="94" r="2.5" fill="#FEF08A" fillOpacity="0.85" />

        {/* 6. Curved Glass Highlight */}
        <path d="M78 91C84 83 98 83 106 91" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
      </svg>
    </div>
  );
}

// =========================================================================
// SEMANTIC ALIAS EXPORTS FOR FULL BACKWARD COMPATIBILITY
// =========================================================================
export const IconFigmaHome = IconHome3D;
export const IconFigmaWallet = IconWallet3D;
export const IconFigmaSecurity = IconSecurity3D;
export const IconFigmaProfile = IconProfile3D;
export const IconFigmaNotification = IconNotification3D;
export const IconFigmaCalendar = IconCalendar3D;
export const IconFigmaMessage = IconMessage3D;
export const IconFigmaLocations = IconLocation3D;
export const IconFigmaElectricity = IconElectricity3D;
export const IconFigmaWater = IconWater3D;
export const IconFigmaElectricWater = IconMeter3D;

export const GlassIconHome = IconHome3D;
export const GlassIconInvoice = IconWallet3D;
export const GlassIconProfile = IconProfile3D;
export const GlassIconCalendar = IconCalendar3D;
export const GlassIconDocument = IconContract3D;
export const GlassIconSecurity = IconSecurity3D;
export const GlassIconLocation = IconLocation3D;
export const GlassIconBell = IconNotification3D;
export const GlassIconElectricWater = IconMeter3D;
export const GlassIconVehicle = IconVehicle3D;
export const GlassIconSetting = IconSettings3D;
export const GlassIconAlert = IconAlert3D;
export const GlassIconLogout = IconLogout3D;
export const GlassIconSearchPlate = IconSearchPlate3D;
export const GlassIconClock = IconClock3D;

// Optional Defs container component (empty now since each SVG contains its own gradient defs)
export function Icons3DDefs() {
  return null;
}
