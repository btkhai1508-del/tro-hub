import React from 'react';

// Wrapper for the Figma 3D Glassmorphic Icon (Cutout / Transparent Background)
interface FigmaIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// 1. Home Icon (Peach / Orange 3D House - Cutout Background)
export function IconFigmaHome({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M78.25 50.36C83.2 45.08 85.68 42.44 88.59 41.51C90.94 40.75 93.46 40.75 95.81 41.51C98.72 42.44 101.2 45.08 106.15 50.36L128.44 74.12C138.18 84.5 143.05 89.69 143.2 94.14C143.31 97.67 141.84 101.07 139.19 103.4C135.84 106.34 128.73 106.34 114.49 106.34H69.91C55.67 106.34 48.56 106.34 45.21 103.4C42.56 101.07 41.08 97.67 41.2 94.14C41.35 89.69 46.22 84.5 55.96 74.12L78.25 50.36Z" fill="url(#fg_home_roof)" />
        <rect x="50" y="80.3" width="83.39" height="64.39" rx="19.28" fill="#F8B77B" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <rect x="80.3" y="103.9" width="23.12" height="17.22" rx="8.61" fill="white" fillOpacity="0.9" />
        <defs>
          <linearGradient id="fg_home_roof" x1="60" y1="56" x2="160" y2="112" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FBA47F" />
            <stop offset="1" stopColor="#DF6B00" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// 2. Wallet Icon (Blue 3D Wallet - Cutout Background)
export function IconFigmaWallet({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="46" y="46.5" width="78.34" height="84.87" rx="19.59" fill="url(#fg_wallet_bg)" />
        <rect x="46.3" y="66.4" width="90.79" height="71.2" rx="19.28" fill="#B9DDFF" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <rect x="104.7" y="85.7" width="39.17" height="26.11" rx="8.16" fill="url(#fg_wallet_bg)" />
        <circle cx="131" cy="98.7" r="6.53" fill="white" />
        <defs>
          <linearGradient id="fg_wallet_bg" x1="68" y1="65" x2="130" y2="84" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7FC0FB" />
            <stop offset="1" stopColor="#4088F4" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// 3. Security / Shield Icon (Mint Green 3D Shield - Cutout Background)
export function IconFigmaSecurity({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M93.4 116.3C100.3 113.7 127.5 100.6 128.7 56.7C128.7 54.8 127.8 53.1 126.2 52.1C105.1 39 78.5 39 57.4 52.1C55.8 53.1 54.9 54.8 54.9 56.7C56.1 100.6 83.3 113.7 90.2 116.3C91.2 116.7 92.4 116.7 93.4 116.3Z" fill="url(#fg_shield_bg)" />
        <path d="M55.3 67.7C77.9 54.8 105.7 54.8 128.3 67.7L131.6 69.6C133.4 70.6 134.6 72.6 134.5 74.7C133.7 98.4 125.2 113.7 116 123.3C106.8 132.9 96.8 136.9 93.2 138.1C92.3 138.4 91.3 138.4 90.4 138.1C86.8 136.9 76.8 132.9 67.6 123.3C58.4 113.7 49.9 98.4 49.1 74.7C49 72.6 50.1 70.6 52 69.6L55.3 67.7Z" fill="#6AE092" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <path d="M107.2 83.4L88.7 101.7L73.3 89.4" stroke="white" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        <defs>
          <linearGradient id="fg_shield_bg" x1="71" y1="61" x2="151" y2="122" gradientUnits="userSpaceOnUse">
            <stop stopColor="#75EDA1" />
            <stop offset="1" stopColor="#349256" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// 4. Profile Icon (Violet / Purple 3D Person - Cutout Background)
export function IconFigmaProfile({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M49.5 90C50.5 84.8 51 82.2 52.2 80.2C53.8 77.5 56.2 75.5 59.2 74.5C61.4 73.7 64 73.7 69.2 73.7H114.1C119.3 73.7 121.9 73.7 124.1 74.5C127 75.5 129.5 77.5 131.1 80.2C132.2 82.2 132.7 84.8 133.7 90C135.1 97.3 135.9 100.9 135.1 103.8C134.1 107.7 131.5 110.9 127.9 112.6C125.2 113.9 121.5 113.9 114.1 113.9H69.2C61.8 113.9 58.1 113.9 55.4 112.6C51.8 110.9 49.1 107.7 48.1 103.8C47.4 100.9 48.1 97.3 49.5 90Z" fill="url(#fg_profile_bg)" />
        <circle cx="92.2" cy="65.7" r="25" fill="#BFB5FF" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <path d="M70.9 144.1L112.5 144.1C123.8 144.1 133 134.9 133 123.6C133 108.5 120.7 96.2 105.5 96.2H77.8C62.7 96.2 50.4 108.5 50.4 123.6C50.4 134.9 59.6 144.1 70.9 144.1Z" fill="#BFB5FF" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <defs>
          <linearGradient id="fg_profile_bg" x1="72" y1="82" x2="120" y2="122" gradientUnits="userSpaceOnUse">
            <stop stopColor="#917FFB" />
            <stop offset="1" stopColor="#3F2DAF" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// 5. Notification Icon (Green 3D Bell - Cutout Background)
export function IconFigmaNotification({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="92.2" cy="119.5" r="26.1" fill="url(#fg_notif_clapper)" />
        <path fillRule="evenodd" clipRule="evenodd" d="M78.8 50.1C78.8 42.7 84.8 36.7 92.2 36.7C99.6 36.7 105.6 42.7 105.6 50.1C105.6 53.6 104.3 56.7 102.2 59.1C116.3 62.3 126.8 74 128.4 88.4L130.7 109C130.8 109.5 130.8 110 130.8 110.5H131.9C135.9 110.5 139.1 113.7 139.1 117.7C139.1 121.2 136.5 124.3 133 124.7C102.4 128.9 82.7 128.9 51.4 124.7C47.9 124.3 45.3 121.2 45.3 117.7C45.3 113.7 48.5 110.5 52.5 110.5H53.6C53.6 110 53.7 109.5 53.7 109L56 88.4C57.6 74 68.2 62.3 82.2 59.1C80.1 56.7 78.8 53.6 78.8 50.1Z" fill="#6AE092" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <defs>
          <linearGradient id="fg_notif_clapper" x1="77" y1="111" x2="128" y2="155" gradientUnits="userSpaceOnUse">
            <stop stopColor="#75EDA1" />
            <stop offset="1" stopColor="#349256" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// 6. Calendar Icon (Red/Pink 3D Calendar - Cutout Background)
export function IconFigmaCalendar({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M45.6 74.5C45.6 68.7 45.6 65.8 46.5 63.5C47.8 60 50.6 57.2 54.1 55.9C56.4 55 59.3 55 65.1 55H119.1C124.9 55 127.8 55 130.1 55.9C133.6 57.2 136.4 60 137.7 63.5C138.6 65.8 138.6 68.7 138.6 74.5V103.2H45.6V74.5Z" fill="url(#fg_cal_bg)" />
        <rect x="59.2" y="40.7" width="19.35" height="26" rx="9.67" fill="#FFB7B5" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <rect x="105.8" y="40.7" width="19.35" height="26" rx="9.67" fill="#FFB7B5" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <path d="M66.9 73.9H117.4C121.2 73.9 123.9 73.9 126.1 74.1C128.3 74.3 129.9 74.7 131.3 75.4C133.7 76.6 135.7 78.6 137 81.1C137.7 82.4 138 84 138.2 86.2C138.4 88.4 138.4 91.2 138.4 94.9V108.2C138.4 113.8 138.4 118 138.1 121.3C137.8 124.6 137.3 127 136.2 129.1C134.4 132.8 131.4 135.8 127.7 137.7C125.6 138.8 123.2 139.3 119.9 139.6C116.6 139.8 112.4 139.9 106.8 139.9H77.5C71.9 139.9 67.8 139.8 64.4 139.6C61.1 139.3 58.7 138.8 56.6 137.7C52.9 135.8 49.9 132.8 48 129.1C47 127 46.4 124.6 46.2 121.3C45.9 118 45.9 113.8 45.9 108.2V94.9C45.9 91.2 45.9 88.4 46.1 86.2C46.3 84 46.6 82.4 47.3 81.1C48.6 78.6 50.6 76.6 53 75.4C54.4 74.7 56 74.3 58.2 74.1C60.4 73.9 63.2 73.9 66.9 73.9Z" fill="#FFB7B5" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <rect x="72.4" y="93.8" width="39.4" height="6.16" rx="3.08" fill="white" />
        <rect x="72.4" y="113.8" width="39.4" height="6.16" rx="3.08" fill="white" />
        <defs>
          <linearGradient id="fg_cal_bg" x1="36" y1="59" x2="65" y2="87" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF6161" />
            <stop offset="1" stopColor="#F52828" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// 7. Message Icon (Blue 3D Envelope - Cutout Background)
export function IconFigmaMessage({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M45.3 85.8C45.3 76.2 45.3 71.3 48 67.8C50.7 64.2 55.3 62.9 64.6 60.3L80.9 55.6C86.3 54.1 89.1 53.3 91.9 53.3C94.7 53.3 97.4 54.1 102.8 55.6L119.1 60.3C128.4 62.9 133 64.2 135.7 67.8C138.4 71.3 138.4 76.2 138.4 85.8V99C138.4 117.8 138.4 127.2 132.6 133.1C126.7 138.9 117.3 138.9 98.5 138.9H85.2C66.4 138.9 57 138.9 51.1 133.1C45.3 127.2 45.3 117.8 45.3 99V85.8Z" fill="url(#fg_msg_bg)" />
        <path d="M61.9 39.5H121.8C124.4 39.5 126.8 40.9 128.6 43.4C130.4 45.8 131.5 49.2 131.5 52.9V82.9C121.8 90.3 114.4 97.6 108.2 103C105.1 105.8 102.2 108 99.6 109.6C96.9 111.2 94.4 112 91.9 112C89.4 112 87 111.1 84.3 109.6C81.6 108 78.8 105.7 75.7 103C69.4 97.6 62 90.3 52.3 82.9V52.9C52.3 49.2 53.4 45.8 55.1 43.4C56.9 40.9 59.3 39.5 61.9 39.5Z" fill="#B9DDFF" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <rect x="73.6" y="59.4" width="39.4" height="6.16" rx="3.08" fill="white" />
        <rect x="73.6" y="79.3" width="39.4" height="6.16" rx="3.08" fill="white" />
        <defs>
          <linearGradient id="fg_msg_bg" x1="72" y1="71" x2="142" y2="97" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7FC0FB" />
            <stop offset="1" stopColor="#4088F4" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// 8. Locations Icon (Red 3D Map Pin - Cutout Background)
export function IconFigmaLocations({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 184 184" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M52.9 116.4C54.1 109.1 54.7 105.4 56.8 102.8C57.7 101.7 58.8 100.8 60.1 100C63 98.4 66.7 98.4 74.1 98.4H109.4C116.8 98.4 120.6 98.4 123.4 100C124.7 100.8 125.8 101.7 126.7 102.8C128.8 105.4 129.4 109.1 130.7 116.4C132.3 126.3 133.1 131.2 131.2 134.9C130.4 136.5 129.2 137.9 127.8 139C124.5 141.5 119.5 141.5 109.4 141.5H74.1C64.1 141.5 59.1 141.5 55.8 139C54.4 137.9 53.2 136.5 52.4 134.9C50.4 131.2 51.3 126.3 52.9 116.4Z" fill="url(#fg_loc_bg)" />
        <path d="M91.8 37.1C108.6 37.1 122.3 51.6 122.3 69.6C122.3 78.6 118.8 91.9 113.3 102.9C110.5 108.4 107.2 113.4 103.6 116.9C99.9 120.5 95.9 122.6 91.8 122.6C87.7 122.6 83.7 120.5 80.1 116.9C76.4 113.4 73.1 108.4 70.4 102.9C64.8 91.9 61.4 78.6 61.4 69.6C61.4 51.6 75 37.1 91.8 37.1Z" fill="#FFB7B5" fillOpacity="0.75" stroke="white" strokeWidth="1" />
        <circle cx="91.8" cy="67.6" r="12" fill="white" />
        <defs>
          <linearGradient id="fg_loc_bg" x1="64" y1="130" x2="123" y2="175" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF6161" />
            <stop offset="1" stopColor="#F52828" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// 9. Electricity Icon (Gold 3D Lightning - Cutout Background)
export function IconFigmaElectricity({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="figma_zap_grad" x1="85%" y1="15%" x2="15%" y2="85%">
            <stop offset="0%" stopColor="#FFF0AA" />
            <stop offset="56%" stopColor="#FFD100" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <filter id="figma_zap_glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <rect x="18" y="14" width="64" height="64" rx="20" fill="url(#figma_zap_grad)" transform="rotate(8 50 50)" />
        <rect x="15" y="15" width="70" height="70" rx="22" fill="rgba(255, 255, 255, 0.45)" stroke="rgba(255, 255, 255, 0.9)" strokeWidth="1.5" />
        <path d="M54 22L30 52H48L42 78L70 46H52L58 22H54Z" fill="#FFFFFF" filter="url(#figma_zap_glow)" stroke="#FFEBA3" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// 10. Water Icon (Cyan 3D Droplet - Cutout Background)
export function IconFigmaWater({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="figma_water_grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7CD4FD" />
            <stop offset="50%" stopColor="#42A0F0" />
            <stop offset="100%" stopColor="#1E88E5" />
          </linearGradient>
        </defs>
        <rect x="18" y="14" width="64" height="64" rx="20" fill="url(#figma_water_grad)" transform="rotate(-8 50 50)" />
        <rect x="15" y="15" width="70" height="70" rx="22" fill="rgba(185, 221, 255, 0.45)" stroke="rgba(255, 255, 255, 0.9)" strokeWidth="1.5" />
        <path d="M50 24 C50 24 32 46 32 60 C32 70 40 78 50 78 C60 78 68 70 68 60 C68 46 50 24 50 24 Z" fill="#FFFFFF" fillOpacity="0.95" stroke="#B9DDFF" strokeWidth="1.5" />
        <ellipse cx="44" cy="54" rx="3.5" ry="7" transform="rotate(-30 44 54)" fill="rgba(255, 255, 255, 0.9)" />
      </svg>
    </div>
  );
}

// 11. Dual Electric & Water Utility Icon
export function IconFigmaElectricWater({ size = 52, className = '', style }: FigmaIconProps) {
  return (
    <div 
      className={`inline-flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="few_zap_grad" x1="85%" y1="15%" x2="15%" y2="85%">
            <stop offset="0%" stopColor="#FFF0AA" />
            <stop offset="56%" stopColor="#FFD100" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <linearGradient id="few_water_grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7CD4FD" />
            <stop offset="50%" stopColor="#42A0F0" />
            <stop offset="100%" stopColor="#1E88E5" />
          </linearGradient>
        </defs>
        <path d="M62 30C62 30 46 50 46 64C46 73 53 80 62 80C71 80 78 73 78 64C78 50 62 30 62 30Z" fill="url(#few_water_grad)" />
        <rect x="12" y="16" width="76" height="68" rx="22" fill="rgba(255, 255, 255, 0.4)" stroke="rgba(255, 255, 255, 0.9)" strokeWidth="1.5" />
        <path d="M42 22L22 50H38L32 76L58 46H42L48 22H42Z" fill="url(#few_zap_grad)" stroke="#FFFFFF" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M68 44C68 44 56 56 56 64C56 70 61 74 67 74C73 74 78 70 78 64C78 56 68 44 68 44Z" fill="#42A0F0" fillOpacity="0.85" stroke="#FFFFFF" strokeWidth="1" />
      </svg>
    </div>
  );
}
