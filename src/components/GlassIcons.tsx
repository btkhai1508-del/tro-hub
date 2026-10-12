import React from 'react';

interface GlassIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Pure Figma Glassmorphism Icons (100% faithful to user Figma design & uploaded images):
 * - Solid vibrant Royal Blue (#003CFF) back accent layer
 * - Ultra-crisp translucent Frosted Glass front shape with subtle linear & radial gradients
 * - Pristine white (#FFFFFF) vector details
 * - True Glass Morphism Soft Drop Shadow for maximum pop without background container boxes
 */

// 1. House / Home Icon (Icon:=House)
export function GlassIconHome({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradHouse" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(225, 236, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradHouse" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Sphere) */}
      <circle cx="26" cy="28" r="22" fill="#003CFF" />

      {/* Front Frosted Glass House */}
      <path 
        d="M58 14 L90 40 C93 42.5 93 46 93 50 L93 84 C93 88 89 92 85 92 L68 92 C65 92 63 90 63 87 L63 68 C63 65 61 63 58 63 L44 63 C41 63 39 65 39 68 L39 87 C39 90 37 92 34 92 L22 92 C18 92 14 88 14 84 L14 50 C14 46 16 42.5 19 40 Z" 
        fill="url(#glassGradHouse)" 
        stroke="url(#strokeGradHouse)" 
        strokeWidth="1.5"
      />
    </svg>
  );
}

// 2. Wallet / Invoice Icon (Icon:=Wallet)
export function GlassIconInvoice({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradWallet" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradWallet" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Card Flap rotated) */}
      <rect 
        x="24" 
        y="8" 
        width="62" 
        height="38" 
        rx="10" 
        fill="#003CFF" 
        transform="rotate(10 24 8)" 
      />

      {/* Front Frosted Glass Wallet Body */}
      <rect 
        x="10" 
        y="26" 
        width="80" 
        height="64" 
        rx="18" 
        fill="url(#glassGradWallet)" 
        stroke="url(#strokeGradWallet)" 
        strokeWidth="1.5"
      />

      {/* Front Wallet Cutout / Flap */}
      <path 
        d="M38 26 C38 38 62 38 62 26 Z" 
        fill="url(#glassGradWallet)" 
        stroke="url(#strokeGradWallet)" 
        strokeWidth="1.2"
      />

      {/* White Snap Dot */}
      <circle cx="50" cy="58" r="9" fill="#FFFFFF" />
      <circle cx="70" cy="65" r="5" fill="#FFFFFF" opacity="0.9" />
    </svg>
  );
}

// 3. Avatar / Profile / User Icon (Icon:=Avatar)
export function GlassIconProfile({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradAvatar" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradAvatar" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Pill) */}
      <rect x="46" y="8" width="46" height="42" rx="14" fill="#003CFF" />

      {/* Front Frosted Glass Smiling Avatar Circle */}
      <circle 
        cx="44" 
        cy="52" 
        r="38" 
        fill="url(#glassGradAvatar)" 
        stroke="url(#strokeGradAvatar)" 
        strokeWidth="1.5"
      />

      {/* White Face Features */}
      <circle cx="32" cy="45" r="4.5" fill="#FFFFFF" />
      <circle cx="56" cy="45" r="4.5" fill="#FFFFFF" />
      <path 
        d="M32 58 C36 68 52 68 56 58" 
        stroke="#FFFFFF" 
        strokeWidth="4" 
        strokeLinecap="round" 
        fill="none" 
      />
    </svg>
  );
}

// 4. Calendar Icon (Icon:=Calendar)
export function GlassIconCalendar({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradCal" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradCal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Ring Holders) */}
      <rect x="28" y="6" width="16" height="22" rx="8" fill="#003CFF" />
      <rect x="62" y="6" width="16" height="22" rx="8" fill="#003CFF" />

      {/* Front Frosted Glass Calendar Body */}
      <rect 
        x="12" 
        y="18" 
        width="76" 
        height="74" 
        rx="22" 
        fill="url(#glassGradCal)" 
        stroke="url(#strokeGradCal)" 
        strokeWidth="1.5"
      />

      {/* White "31" Text */}
      <text 
        x="50" 
        y="68" 
        textAnchor="middle" 
        fill="#FFFFFF" 
        fontFamily="-apple-system, SF Pro Display, sans-serif" 
        fontWeight="bold" 
        fontSize="34"
        letterSpacing="-1"
      >
        31
      </text>
    </svg>
  );
}

// 5. Clock Icon (Icon:=Clock)
export function GlassIconClock({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradClock" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradClock" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Bell Top) */}
      <circle cx="50" cy="24" r="18" fill="#003CFF" />

      {/* Front Frosted Glass Dial */}
      <circle 
        cx="50" 
        cy="56" 
        r="40" 
        fill="url(#glassGradClock)" 
        stroke="url(#strokeGradClock)" 
        strokeWidth="1.5"
      />

      {/* White Clock Hands */}
      <line x1="50" y1="56" x2="50" y2="34" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="50" y1="56" x2="68" y2="68" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="50" cy="56" r="4" fill="#FFFFFF" />
    </svg>
  );
}

// 6. Lock / Security Icon (Icon:=Lock)
export function GlassIconSecurity({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradLock" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradLock" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Shackle) */}
      <path 
        d="M28 42 L28 26 C28 14 38 8 50 8 C62 8 72 14 72 26 L72 42" 
        stroke="#003CFF" 
        strokeWidth="12" 
        strokeLinecap="round" 
        fill="none" 
      />

      {/* Front Frosted Glass Body */}
      <rect 
        x="12" 
        y="36" 
        width="76" 
        height="56" 
        rx="20" 
        fill="url(#glassGradLock)" 
        stroke="url(#strokeGradLock)" 
        strokeWidth="1.5"
      />

      {/* White Keyhole */}
      <circle cx="50" cy="60" r="6" fill="#FFFFFF" />
      <path d="M47 62 L53 62 L55 74 L45 74 Z" fill="#FFFFFF" />
    </svg>
  );
}

// 7. Location / Map / Pin Icon (Icon:=Map & Icon:=Pin)
export function GlassIconLocation({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradPin" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradPin" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Base) */}
      <ellipse cx="50" cy="78" rx="42" ry="18" fill="#003CFF" />

      {/* Front Frosted Glass Map Pin */}
      <path 
        d="M50 84 C50 84 82 52 82 34 C82 16 68 6 50 6 C32 6 18 16 18 34 C18 52 50 84 50 84 Z" 
        fill="url(#glassGradPin)" 
        stroke="url(#strokeGradPin)" 
        strokeWidth="1.5"
      />

      {/* White Center Hole */}
      <circle cx="50" cy="34" r="11" fill="#FFFFFF" />
    </svg>
  );
}

// 8. Tag / Discount Icon (Icon:=Tag)
export function GlassIconTag({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradTag" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradTag" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Tag rotated) */}
      <rect x="32" y="10" width="58" height="46" rx="12" fill="#003CFF" transform="rotate(-30 32 10)" />

      {/* Front Frosted Glass Tag */}
      <path 
        d="M14 42 L46 14 C48 12 52 12 55 14 L86 45 C88 47 88 51 86 54 L54 86 C51 88 47 88 45 86 L14 55 C12 52 12 48 14 45 Z" 
        fill="url(#glassGradTag)" 
        stroke="url(#strokeGradTag)" 
        strokeWidth="1.5"
      />

      {/* White % text & hole */}
      <circle cx="36" cy="34" r="5" fill="#FFFFFF" />
      <text 
        x="56" 
        y="66" 
        textAnchor="middle" 
        fill="#FFFFFF" 
        fontFamily="-apple-system, sans-serif" 
        fontWeight="bold" 
        fontSize="24"
      >
        %
      </text>
    </svg>
  );
}

// 9. Calculator Icon (Icon:=Calculator)
export function GlassIconCalculator({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradCalc" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradCalc" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Pill) */}
      <rect x="48" y="16" width="46" height="68" rx="20" fill="#003CFF" />

      {/* Front Frosted Glass Body */}
      <rect 
        x="10" 
        y="10" 
        width="72" 
        height="80" 
        rx="22" 
        fill="url(#glassGradCalc)" 
        stroke="url(#strokeGradCalc)" 
        strokeWidth="1.5"
      />

      {/* White Calculator symbols (+ - × =) */}
      <line x1="28" y1="32" x2="42" y2="46" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
      <line x1="42" y1="32" x2="28" y2="46" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />

      <line x1="58" y1="32" x2="58" y2="46" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
      <line x1="51" y1="39" x2="65" y2="39" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />

      <line x1="26" y1="67" x2="44" y2="67" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />

      <line x1="52" y1="63" x2="68" y2="63" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
      <line x1="52" y1="71" x2="68" y2="71" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

// 10. Key Icon (Icon:=Key)
export function GlassIconKey({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradKey" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradKey" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Key) */}
      <circle cx="28" cy="42" r="22" fill="#003CFF" />
      <rect x="24" y="52" width="16" height="42" rx="6" fill="#003CFF" />

      {/* Front Frosted Glass Angled Key */}
      <circle 
        cx="52" 
        cy="34" 
        r="26" 
        fill="url(#glassGradKey)" 
        stroke="url(#strokeGradKey)" 
        strokeWidth="1.5"
      />
      <rect 
        x="50" 
        y="50" 
        width="16" 
        height="42" 
        rx="8" 
        fill="url(#glassGradKey)" 
        stroke="url(#strokeGradKey)" 
        strokeWidth="1.5" 
        transform="rotate(-25 50 50)" 
      />

      {/* White Keyhole Hole */}
      <circle cx="50" cy="30" r="7" fill="#FFFFFF" />
    </svg>
  );
}

// 11. Conversation / Chat / Note Icon (Icon:=Conversation & Icon:=Note)
export function GlassIconChat({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradChat" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradChat" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Bubble) */}
      <rect x="36" y="12" width="56" height="46" rx="18" fill="#003CFF" />

      {/* Front Frosted Glass Speech Bubble */}
      <path 
        d="M12 28 C12 18 20 12 30 12 L70 12 C80 12 88 18 88 28 L88 56 C88 66 80 72 70 72 L32 72 L16 88 L18 72 C14 70 12 64 12 56 Z" 
        fill="url(#glassGradChat)" 
        stroke="url(#strokeGradChat)" 
        strokeWidth="1.5"
      />

      {/* White Heart / Message Details */}
      <path 
        d="M42 34 C38 28 28 32 28 40 C28 50 42 58 42 58 C42 58 56 50 56 40 C56 32 46 28 42 34 Z" 
        fill="#FFFFFF" 
      />
      <circle cx="68" cy="42" r="4" fill="#FFFFFF" />
    </svg>
  );
}

// 12. Crescent / Moon / Dark Mode Icon (Icon:=Crescent)
export function GlassIconMoon({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradMoon" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradMoon" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Star / Moon) */}
      <circle cx="66" cy="32" r="22" fill="#003CFF" />

      {/* Front Frosted Glass Crescent Moon */}
      <path 
        d="M62 14 C40 16 22 34 22 56 C22 78 40 96 62 96 C74 96 84 90 90 82 C68 84 48 66 48 48 C48 32 60 18 76 14 C72 14 67 14 62 14 Z" 
        fill="url(#glassGradMoon)" 
        stroke="url(#strokeGradMoon)" 
        strokeWidth="1.5"
      />
    </svg>
  );
}

// 13. Cloud / Weather Icon (Icon:=Cloud)
export function GlassIconCloud({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(0,60,255,0.22)] drop-shadow-[0_2px_6px_rgba(0,60,255,0.12)] transition-transform duration-200 ${className}`}
      style={style}
    >
      <defs>
        <linearGradient id="glassGradCloud" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" stopColor="rgba(235, 243, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(165, 195, 255, 0.65)" />
          <stop offset="100%" stopColor="rgba(195, 218, 255, 0.85)" />
        </linearGradient>
        <linearGradient id="strokeGradCloud" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#88A4FF" />
          <stop offset="100%" stopColor="rgba(180, 210, 255, 0.4)" />
        </linearGradient>
      </defs>

      {/* Back Solid Accent (Blue Sun) */}
      <circle cx="68" cy="34" r="24" fill="#003CFF" />

      {/* Front Frosted Glass Cloud */}
      <path 
        d="M28 78 L74 78 C84 78 92 70 92 60 C92 50 84 42 74 42 C73 42 72 42 71 42 C68 28 56 18 42 18 C26 18 14 30 14 46 C14 48 14 50 15 52 C10 56 8 62 8 68 C8 74 16 78 28 78 Z" 
        fill="url(#glassGradCloud)" 
        stroke="url(#strokeGradCloud)" 
        strokeWidth="1.5"
      />
    </svg>
  );
}


// Added from tro-hub 1:
export function GlassIconTick({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 drop-shadow-[0_8px_16px_rgba(38,171,91,0.35)] transition-transform duration-200 ${className}`} style={style}>
      <defs>
        <linearGradient id="gradTickBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#9BF763" />
          <stop offset="100%" stopColor="#26AB5B" />
        </linearGradient>
        <linearGradient id="gradTickGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(114, 220, 96, 0.4)" />
        </linearGradient>
      </defs>
      {/* Back shape */}
      <rect x="24" y="8" width="62" height="62" rx="20" fill="url(#gradTickBg)" transform="rotate(15 24 8)" />
      {/* Glow shadow */}
      <rect x="32" y="16" width="48" height="48" rx="16" fill="#39B93A" opacity="0.45" filter="blur(6px)" transform="rotate(15 32 16)" />
      {/* Front Glass plate */}
      <rect x="10" y="24" width="68" height="68" rx="22" fill="url(#gradTickGlass)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      {/* White checkmark */}
      <path d="M30 58 L42 70 L62 46" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GlassIconDocument({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 drop-shadow-[0_8px_16px_rgba(159,102,255,0.35)] transition-transform duration-200 ${className}`} style={style}>
      <defs>
        <linearGradient id="gradDocBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#BC94FF" />
          <stop offset="100%" stopColor="#9F66FF" />
        </linearGradient>
        <linearGradient id="gradDocGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(186, 144, 255, 0.35)" />
        </linearGradient>
      </defs>
      {/* Back shape rotated */}
      <rect x="26" y="8" width="58" height="74" rx="16" fill="url(#gradDocBg)" transform="rotate(-15 26 8)" />
      <rect x="34" y="16" width="46" height="58" rx="12" fill="#8237FF" opacity="0.45" filter="blur(7px)" transform="rotate(-15 34 16)" />
      {/* Front Glass Paper */}
      <rect x="18" y="20" width="64" height="74" rx="18" fill="url(#gradDocGlass)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      {/* Text lines */}
      <rect x="30" y="38" width="40" height="5" rx="2.5" fill="#FFFFFF" />
      <rect x="30" y="50" width="40" height="5" rx="2.5" fill="#FFFFFF" opacity="0.9" />
      <rect x="30" y="62" width="24" height="5" rx="2.5" fill="#FFFFFF" opacity="0.7" />
    </svg>
  );
}

export function GlassIconLock({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 drop-shadow-[0_8px_16px_rgba(159,102,255,0.35)] transition-transform duration-200 ${className}`} style={style}>
      <defs>
        <linearGradient id="gradLockBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#BC94FF" />
          <stop offset="100%" stopColor="#9F66FF" />
        </linearGradient>
        <linearGradient id="gradLockGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(186, 144, 255, 0.35)" />
        </linearGradient>
      </defs>
      {/* Back Solid Accent */}
      <rect x="22" y="10" width="58" height="58" rx="18" fill="url(#gradLockBg)" transform="rotate(-15 22 10)" />
      {/* Front Lock Body */}
      <rect x="18" y="38" width="64" height="52" rx="18" fill="url(#gradLockGlass)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      {/* Shackle */}
      <path d="M34 38 L34 26 C34 17 41 10 50 10 C59 10 66 17 66 26 L66 38" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" fill="none" />
      {/* Keyhole */}
      <circle cx="50" cy="58" r="5" fill="#FFFFFF" />
      <rect x="48" y="58" width="4" height="12" rx="2" fill="#FFFFFF" />
    </svg>
  );
}

export function GlassIconNotification({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 drop-shadow-[0_8px_16px_rgba(57,175,253,0.35)] transition-transform duration-200 ${className}`} style={style}>
      <defs>
        <linearGradient id="gradNotifBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#39AFFD" />
          <stop offset="100%" stopColor="#477FFF" />
        </linearGradient>
        <linearGradient id="gradNotifGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(62, 160, 254, 0.35)" />
        </linearGradient>
      </defs>
      <rect x="24" y="8" width="60" height="60" rx="20" fill="url(#gradNotifBg)" transform="rotate(15 24 8)" />
      <path d="M50 18 C38 18 30 28 30 42 L30 62 L22 70 L78 70 L70 62 L70 42 C70 28 62 18 50 18 Z" fill="url(#gradNotifGlass)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <circle cx="50" cy="82" r="7" fill="#FFFFFF" />
    </svg>
  );
}

export function GlassIconHeart({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 drop-shadow-[0_8px_16px_rgba(255,25,110,0.35)] transition-transform duration-200 ${className}`} style={style}>
      <defs>
        <linearGradient id="gradHeartBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF759F" />
          <stop offset="100%" stopColor="#FF196E" />
        </linearGradient>
        <linearGradient id="gradHeartGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(255, 116, 159, 0.35)" />
        </linearGradient>
      </defs>
      <circle cx="68" cy="36" r="24" fill="url(#gradHeartBg)" />
      <path d="M50 86 C50 86 16 64 16 38 C16 24 28 14 42 16 C46 17 48 20 50 24 C52 20 54 17 58 16 C72 14 84 24 84 38 C84 64 50 86 50 86 Z" fill="url(#gradHeartGlass)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <circle cx="40" cy="30" r="5" fill="#FFFFFF" opacity="0.9" />
    </svg>
  );
}

export function GlassIconStar({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 drop-shadow-[0_8px_16px_rgba(242,62,44,0.35)] transition-transform duration-200 ${className}`} style={style}>
      <defs>
        <linearGradient id="gradStarBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFA78F" />
          <stop offset="100%" stopColor="#F23E2C" />
        </linearGradient>
        <linearGradient id="gradStarGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(255, 172, 149, 0.4)" />
        </linearGradient>
      </defs>
      <circle cx="68" cy="30" r="22" fill="url(#gradStarBg)" />
      <path d="M50 14 L60 36 L84 38 L66 54 L72 78 L50 64 L28 78 L34 54 L16 38 L40 36 Z" fill="url(#gradStarGlass)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
    </svg>
  );
}

export function GlassIconSetting({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 drop-shadow-[0_8px_16px_rgba(255,25,110,0.35)] transition-transform duration-200 ${className}`} style={style}>
      <defs>
        <linearGradient id="gradSetBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF759F" />
          <stop offset="100%" stopColor="#FF196E" />
        </linearGradient>
        <linearGradient id="gradSetGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(255, 116, 159, 0.35)" />
        </linearGradient>
      </defs>
      <rect x="22" y="10" width="58" height="58" rx="18" fill="url(#gradSetBg)" transform="rotate(15 22 10)" />
      <circle cx="50" cy="50" r="32" fill="url(#gradSetGlass)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="12" fill="#FFFFFF" />
    </svg>
  );
}

export function GlassIconChart({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 drop-shadow-[0_8px_16px_rgba(255,123,13,0.35)] transition-transform duration-200 ${className}`} style={style}>
      <defs>
        <linearGradient id="gradChartBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFB37F" />
          <stop offset="100%" stopColor="#FF7B0D" />
        </linearGradient>
        <linearGradient id="gradChartGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(255, 203, 185, 0.35)" />
        </linearGradient>
      </defs>
      <rect x="24" y="8" width="60" height="60" rx="18" fill="url(#gradChartBg)" transform="rotate(-15 24 8)" />
      <rect x="12" y="20" width="76" height="70" rx="20" fill="url(#gradChartGlass)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      {/* Bars */}
      <rect x="26" y="54" width="10" height="24" rx="5" fill="#FFFFFF" />
      <rect x="44" y="40" width="10" height="38" rx="5" fill="#FFFFFF" />
      <rect x="62" y="30" width="10" height="48" rx="5" fill="#FFFFFF" />
    </svg>
  );
}

// 22. Bell / Notification Icon (Mint / Emerald Green Glass Bell - Pure Transparent Cutout)
export function GlassIconBell({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(16,185,129,0.35)] transition-transform duration-200 ${className}`} 
      style={style}
    >
      <defs>
        <linearGradient id="gradBellBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <radialGradient id="gradBellInnerGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2ECC71" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#48E58D" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#7EF5B5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gradBellGlass" x1="20%" y1="10%" x2="80%" y2="90%">
          <stop offset="0%" stopColor="#A8F8CE" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#63E79D" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#3CD67E" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="gradBellClapper" x1="30%" y1="20%" x2="70%" y2="90%">
          <stop offset="0%" stopColor="#3BD57D" />
          <stop offset="100%" stopColor="#1B8748" />
        </linearGradient>
      </defs>
      {/* Back Solid Emerald Accent (Rotated squircle) */}
      <rect x="22" y="10" width="56" height="56" rx="18" fill="url(#gradBellBg)" transform="rotate(15 22 10)" />
      {/* Bottom Clapper Sphere */}
      <circle cx="50" cy="74" r="10" fill="url(#gradBellClapper)" />
      {/* Inner Glow */}
      <circle cx="50" cy="46" r="14" fill="url(#gradBellInnerGlow)" />
      {/* Front Frosted Glass Bell Dome */}
      <path 
        d="M50 16 C36 16 28 28 28 46 L28 62 L20 70 L80 70 L72 62 L72 46 C72 28 64 16 50 16 Z" 
        fill="url(#gradBellGlass)" 
        stroke="rgba(255, 255, 255, 0.85)" 
        strokeWidth="1.5" 
      />
      {/* Top Knob Sphere */}
      <circle cx="50" cy="14" r="6" fill="#A8F8CE" stroke="#FFFFFF" strokeWidth="1" />
    </svg>
  );
}

// 23. Electricity & Water Icon (Blue Water Droplet + Golden 3D Lightning - Pure Transparent Cutout)
export function GlassIconElectricWater({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(59,130,246,0.35)] transition-transform duration-200 ${className}`} 
      style={style}
    >
      <defs>
        <linearGradient id="gradEWWater" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
        <linearGradient id="gradEWZap" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="50%" stopColor="#FACC15" />
          <stop offset="100%" stopColor="#EAB308" />
        </linearGradient>
        <linearGradient id="gradEWGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.9)" />
          <stop offset="100%" stopColor="rgba(191, 219, 254, 0.4)" />
        </linearGradient>
      </defs>
      {/* Back Solid Blue Water Droplet Plate */}
      <path 
        d="M62 18 C62 18 38 46 38 64 C38 78 49 88 62 88 C75 88 86 78 86 64 C86 46 62 18 62 18 Z" 
        fill="url(#gradEWWater)" 
      />
      {/* Front Frosted Glass Droplet Outline */}
      <path 
        d="M62 26 C62 26 44 48 44 62 C44 72 52 80 62 80 C72 80 80 72 80 62 C80 48 62 26 62 26 Z" 
        fill="url(#gradEWGlass)" 
        stroke="rgba(255, 255, 255, 0.75)" 
        strokeWidth="1.5" 
      />
      {/* Golden 3D Lightning Zap across the front */}
      <path 
        d="M42 16 L20 48 L38 48 L30 84 L62 44 L44 44 L52 16 Z" 
        fill="url(#gradEWZap)" 
        stroke="#FFFFFF" 
        strokeWidth="2" 
        strokeLinejoin="round" 
      />
    </svg>
  );
}

// 24. License Plate Search Icon (Cyan / Sky Plate + 3D Frosted Glass Magnifier - Pure Transparent Cutout)
export function GlassIconSearchPlate({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(14,165,233,0.35)] transition-transform duration-200 ${className}`} 
      style={style}
    >
      <defs>
        <linearGradient id="gradPlateBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
        <linearGradient id="gradLensGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.9)" />
          <stop offset="100%" stopColor="rgba(186, 230, 253, 0.45)" />
        </linearGradient>
        <linearGradient id="gradLensRim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E0F2FE" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
        <linearGradient id="gradLensHandle" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0369A1" />
        </linearGradient>
      </defs>
      {/* Back Solid Accent Plate (Rotated License Plate) */}
      <rect x="16" y="20" width="58" height="38" rx="10" fill="url(#gradPlateBg)" transform="rotate(-12 16 20)" />
      {/* Plate lines */}
      <g transform="rotate(-12 16 20)">
        <rect x="22" y="26" width="20" height="4" rx="2" fill="#FFFFFF" opacity="0.85" />
        <rect x="22" y="34" width="44" height="6" rx="3" fill="#FFFFFF" />
        <rect x="22" y="44" width="30" height="5" rx="2.5" fill="#E0F2FE" opacity="0.9" />
      </g>
      {/* Front 3D Frosted Glass Magnifier */}
      <circle cx="58" cy="52" r="21" fill="url(#gradLensGlass)" stroke="url(#gradLensRim)" strokeWidth="3" />
      {/* Magnifier Handle */}
      <line x1="73" y1="67" x2="89" y2="83" stroke="url(#gradLensHandle)" strokeWidth="6" strokeLinecap="round" />
      {/* Specular Curved Reflection on Glass Lens */}
      <path d="M47 43 C52 38 60 38 66 42" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// 25. Logout / Exit Icon (Rose / Red 3D Glass Door & Arrow - Pure Transparent Cutout)
export function GlassIconLogout({ size = 32, className = '', style }: GlassIconProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={`shrink-0 drop-shadow-[0_8px_16px_rgba(244,63,94,0.35)] transition-transform duration-200 ${className}`} 
      style={style}
    >
      <defs>
        <linearGradient id="gradLogoutBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FB7185" />
          <stop offset="100%" stopColor="#E11D48" />
        </linearGradient>
        <linearGradient id="gradLogoutGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.9)" />
          <stop offset="100%" stopColor="rgba(254, 205, 211, 0.35)" />
        </linearGradient>
      </defs>
      {/* Back Solid Rose Accent (Rotated squircle) */}
      <rect x="20" y="12" width="58" height="58" rx="18" fill="url(#gradLogoutBg)" transform="rotate(-12 20 12)" />
      {/* Front Frosted Glass Door Frame */}
      <rect x="16" y="20" width="46" height="62" rx="12" fill="url(#gradLogoutGlass)" stroke="rgba(255,255,255,0.75)" strokeWidth="1.5" />
      {/* Exit Doorway Line */}
      <path d="M42 32 H28 C26 32 24 34 24 36 V66 C24 68 26 70 28 70 H42" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
      {/* Forward Arrow */}
      <path d="M38 51 H76 M64 39 L76 51 L64 63" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

