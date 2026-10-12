import React from 'react';

interface GoogleIconProps {
  name: string;
  size?: number;
  className?: string;
  filled?: boolean;
}

export function GoogleIcon({ name, size = 24, className = '', filled = false }: GoogleIconProps) {
  return (
    <span
      className={`material-symbols-rounded select-none inline-flex items-center justify-center leading-none ${className}`}
      style={{
        fontFamily: "'Material Symbols Rounded'",
        fontSize: `${size}px`,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
        width: `${size}px`,
        height: `${size}px`,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
