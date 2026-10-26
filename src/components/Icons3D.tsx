import React from 'react';
import { Clock as LucideClock } from 'lucide-react';
import { KitIcon } from './KitIcons';

export interface Icon3DProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function IconHome3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Home" size={size} className={className} style={style} />;
}

export function IconWallet3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Wallet" size={size} className={className} style={style} />;
}

export function IconSecurity3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Shield" size={size} className={className} style={style} />;
}

export function IconProfile3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Profile" size={size} className={className} style={style} />;
}

export function IconNotification3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Bell" size={size} className={className} style={style} />;
}

export function IconCalendar3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Calendar" size={size} className={className} style={style} />;
}

export function IconMessage3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Chat" size={size} className={className} style={style} />;
}
export const IconChat3D = IconMessage3D;

export function IconLocation3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Location" size={size} className={className} style={style} />;
}

export function IconElectricity3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceElectricity" size={size} className={className} style={style} />; }

export function IconWater3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceWater" size={size} className={className} style={style} />; }

export function IconMeter3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceMeter" size={size} className={className} style={style} />; }

export function IconLock3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Key" size={size} className={className} style={style} />;
}
export const IconKey3D = IconLock3D;

export function IconMagnifier3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Search" size={size} className={className} style={style} />;
}
export const IconSearchPlate3D = IconMagnifier3D;

export function IconCamera3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Camera" size={size} className={className} style={style} />;
}

export function IconCart3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Buy" size={size} className={className} style={style} />;
}

export function IconFolder3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Folder" size={size} className={className} style={style} />;
}

export function IconPencil3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Edit" size={size} className={className} style={style} />;
}

export function IconPicture3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Gallery" size={size} className={className} style={style} />;
}

export function IconSettings3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Settings" size={size} className={className} style={style} />;
}

export function IconShare3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Send" size={size} className={className} style={style} />;
}

export function IconSuitcase3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="BagAlt" size={size} className={className} style={style} />;
}

export function IconTrash3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceTrash" size={size} className={className} style={style} />; }
export const IconCleanliness3D = IconTrash3D;

export function IconClock3D({ size = 48, className = '', style, strokeWidth = 1.8 }: Icon3DProps & { strokeWidth?: number }) {
  if (size <= 28) {
    return <LucideClock size={size} className={className} style={style} strokeWidth={strokeWidth} />;
  }
  return <KitIcon name="Clock" size={size} className={className} style={style} />;
}

export function IconAlert3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Danger" size={size} className={className} style={style} />;
}

export function IconContract3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Document" size={size} className={className} style={style} />;
}
export const IconDeclaration3D = IconContract3D;
export const IconHandbook3D = IconContract3D;

export function IconVehicle3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceVehicle" size={size} className={className} style={style} />; }

export function IconWifi3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceWifi" size={size} className={className} style={style} />; }

export function IconMaintenance3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceMaintenance" size={size} className={className} style={style} />; }

export function IconSupport3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Chat" size={size} className={className} style={style} />;
}

export function IconGuide3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="InfoAlt" size={size} className={className} style={style} />;
}

export function IconTick3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Tick" size={size} className={className} style={style} />;
}

export function IconLogout3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceLogout" size={size} className={className} style={style} />; }

export function IconStar3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Star" size={size} className={className} style={style} />;
}

export function IconHeart3D({ size = 48, className = '', style }: Icon3DProps & { strokeWidth?: number }) {
  return <KitIcon name="Heart" size={size} className={className} style={style} />;
}

export function IconLaundry3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceLaundry" size={size} className={className} style={style} />; }

export function IconDryer3D({ size = 48, className = '', style }: Icon3DProps) { return <KitIcon name="ServiceDryer" size={size} className={className} style={style} />; }

export const IconFigmaHome = IconHome3D;
export const IconFigmaWallet = IconWallet3D;
export const IconFigmaSecurity = IconSecurity3D;
export const IconFigmaProfile = IconProfile3D;
export const IconFigmaNotification = IconNotification3D;
export const IconFigmaCalendar = IconCalendar3D;
export const IconFigmaMessage = IconMessage3D;
export const IconFigmaLocations = IconLocation3D;
export const IconFigmaCamera = IconCamera3D;
export const IconFigmaCart = IconCart3D;
export const IconFigmaFolder = IconFolder3D;
export const IconFigmaPencil = IconPencil3D;
export const IconFigmaPicture = IconPicture3D;
export const IconFigmaSettings = IconSettings3D;
export const IconFigmaShare = IconShare3D;
export const IconFigmaSuitcase = IconSuitcase3D;
export const IconFigmaTrash = IconTrash3D;
export const IconFigmaClock = IconClock3D;
export const IconFigmaAlert = IconAlert3D;
export const IconFigmaDocument = IconContract3D;
export const GlassIconHome = IconHome3D;
export const GlassIconWallet = IconWallet3D;
export const GlassIconProfile = IconProfile3D;
export const GlassIconBell = IconNotification3D;
export const GlassIconCalendar = IconCalendar3D;
export const GlassIconMessage = IconMessage3D;
export const GlassIconLocation = IconLocation3D;
export const GlassIconClock = IconClock3D;
export const GlassIconSettings = IconSettings3D;
export const GlassIconContract = IconContract3D;
export const GlassIconFolder = IconFolder3D;
export const GlassIconCamera = IconCamera3D;
export const GlassIconEdit = IconPencil3D;
export const GlassIconGallery = IconPicture3D;
export const GlassIconDanger = IconAlert3D;
export const GlassIconShield = IconSecurity3D;
export const GlassIconSend = IconShare3D;
export const GlassIconSearch = IconMagnifier3D;
export function Icons3DDefs() { return null; }
