import React from 'react';

/** Original transparent SVG artwork supplied by the user. Each external SVG
 * keeps its own gradient/mask IDs, avoiding collisions between instances. */
export const KIT_ASSETS = {
  ServiceDryer: '/icons/kit/service-dryer.svg',
  ServiceLaundry: '/icons/kit/service-laundry.svg',
  ServiceLogout: '/icons/kit/service-logout.svg',
  ServiceMaintenance: '/icons/kit/service-maintenance.svg',
  ServiceWifi: '/icons/kit/service-wifi.svg',
  ServiceVehicle: '/icons/kit/service-vehicle.svg',
  ServiceTrash: '/icons/kit/service-trash.svg',
  ServiceMeter: '/icons/kit/service-meter.svg',
  ServiceWater: '/icons/kit/service-water.svg',
  ServiceElectricity: '/icons/kit/service-electricity.svg',
  Wrench: '/icons/kit/symbol-wrench.svg',
  Monitor: '/icons/kit/symbol-monitor.svg',
  Sunrise: '/icons/kit/symbol-sunrise.svg',
  WifiOff: '/icons/kit/symbol-wifioff.svg',
  Phone: '/icons/kit/symbol-phone.svg',
  PhoneCall: '/icons/kit/symbol-phonecall.svg',
  QrCode: '/icons/kit/symbol-qrcode.svg',
  Wifi: '/icons/kit/symbol-wifi.svg',
  RotateCcw: '/icons/kit/symbol-rotateccw.svg',
  Flame: '/icons/kit/symbol-flame.svg',
  WashingMachine: '/icons/kit/symbol-washingmachine.svg',
  Moon: '/icons/kit/symbol-moon.svg',
  Sun: '/icons/kit/symbol-sun.svg',
  Bike: '/icons/kit/symbol-bike.svg',
  Droplet: '/icons/kit/symbol-droplet.svg',
  Printer: '/icons/kit/symbol-printer.svg',
  RefreshCw: '/icons/kit/symbol-refreshcw.svg',
  Power: '/icons/kit/symbol-power.svg',
  Zap: '/icons/kit/symbol-zap.svg',
  "Show": "/icons/kit/show.svg",
  "Upload": "/icons/kit/arrow-1.svg",
  "Add": "/icons/kit/add.svg",
  "InfoAlt": "/icons/kit/info-1.svg",
  "Home": "/icons/kit/home.svg",
  "Chart": "/icons/kit/chart.svg",
  "Wallet": "/icons/kit/wallet.svg",
  "Volume": "/icons/kit/volume.svg",
  "Camera": "/icons/kit/camera.svg",
  "Key": "/icons/kit/lock-1.svg",
  "Profile": "/icons/kit/profile.svg",
  "Paper": "/icons/kit/paper.svg",
  "Close": "/icons/kit/close.svg",
  "PaperPlus": "/icons/kit/paper-plus.svg",
  "Info": "/icons/kit/info.svg",
  "Shield": "/icons/kit/shield.svg",
  "More": "/icons/kit/menu-1.svg",
  "Activity": "/icons/kit/activity.svg",
  "Calendar": "/icons/kit/calendar.svg",
  "BagAlt": "/icons/kit/bag-1.svg",
  "Document": "/icons/kit/document.svg",
  "Search": "/icons/kit/search.svg",
  "Message": "/icons/kit/message.svg",
  "Settings": "/icons/kit/setting.svg",
  "Graph": "/icons/kit/graph.svg",
  "Menu": "/icons/kit/menu.svg",
  "Edit": "/icons/kit/edit.svg",
  "Location": "/icons/kit/location.svg",
  "Lock": "/icons/kit/lock.svg",
  "Folder": "/icons/kit/folder.svg",
  "Danger": "/icons/kit/danger.svg",
  "Filter": "/icons/kit/filter.svg",
  "Video": "/icons/kit/video.svg",
  "Bell": "/icons/kit/notification.svg",
  "Discount": "/icons/kit/discount.svg",
  "Send": "/icons/kit/send.svg",
  "Bag": "/icons/kit/bag.svg",
  "StarAlt": "/icons/kit/star-1.svg",
  "Buy": "/icons/kit/buy.svg",
  "Play": "/icons/kit/play.svg",
  "Gallery": "/icons/kit/gallery.svg",
  "Discovery": "/icons/kit/discovery.svg",
  "Arrow": "/icons/kit/arrow.svg",
  "Clock": "/icons/kit/clock.svg",
  "Star": "/icons/kit/star.svg",
  "Game": "/icons/kit/game.svg",
  "Chat": "/icons/kit/chat.svg",
  "Bookmark": "/icons/kit/bookmark.svg",
  "Tick": "/icons/kit/tick.svg",
  "Heart": "/icons/kit/heart.svg"
} as const;
export type KitIconName = keyof typeof KIT_ASSETS;
export interface KitIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  color?: string;
  fill?: string;
}
export function createKitIcon(name: KitIconName, rotation = 0, variant?: 'hidden' | 'plus' | 'minus') {
  function AssetIcon({ size = 24, className = '', style, strokeWidth: _stroke, absoluteStrokeWidth: _absolute, color: _color, fill: _fill, children: _children, ...props }: KitIconProps) {
    const labelled = Boolean(props['aria-label'] || props['aria-labelledby']);
    return (
      <span {...props} aria-hidden={props['aria-hidden'] ?? !labelled} role={labelled ? 'img' : props.role} data-kit-icon={name} className={`kit-asset-icon ${variant === 'hidden' ? 'kit-icon-hidden' : ''} ${className}`} style={{ width: size, height: size, ...style }}>
        <img src={KIT_ASSETS[name]} alt="" aria-hidden="true" draggable={false} decoding="async" style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }} />
        {(variant === 'plus' || variant === 'minus') && <span aria-hidden="true" className="kit-icon-mark">{variant === 'plus' ? '+' : '−'}</span>}
      </span>
    );
  }
  AssetIcon.displayName = `Kit${name}`;
  return AssetIcon;
}
export const KitIcon = ({ name, ...props }: KitIconProps & { name: KitIconName }) => {
  const labelled = Boolean(props['aria-label'] || props['aria-labelledby']);
  const { size = 48, className = '', style, strokeWidth: _stroke, absoluteStrokeWidth: _absolute, color: _color, fill: _fill, children: _children, ...rest } = props;
  return <span {...rest} aria-hidden={rest['aria-hidden'] ?? !labelled} role={labelled ? 'img' : rest.role} data-kit-icon={name} className={`kit-asset-icon ${className}`} style={{ width: size, height: size, ...style }}><img src={KIT_ASSETS[name]} alt="" aria-hidden="true" draggable={false} decoding="async" /></span>;
};
