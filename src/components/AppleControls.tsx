import React from 'react';
import { cn } from '../lib/utils';
import { Check } from './AppIcons';
import { soundFx } from '../lib/soundFx';

export interface AppleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  color?: 'theme' | 'emerald' | 'orange' | 'blue';
  className?: string;
  ariaLabel?: string;
}

/** A compact material track inside a 44px touch target. */
export const AppleSwitch: React.FC<AppleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  color = 'theme',
  className,
  ariaLabel = 'Switch toggle',
}) => {
  // Dimensions per size
  const sizeConfig = {
    sm: {
      track: 'w-10 h-6',
      knob: 'w-4.5 h-4.5 top-[3px]',
      translate: 'translate-x-[18px]',
      baseTranslate: 'translate-x-[3px]',
    },
    md: {
      track: 'w-12 h-7',
      knob: 'w-5.5 h-5.5 top-[3px]',
      translate: 'translate-x-[22px]',
      baseTranslate: 'translate-x-[3px]',
    },
    lg: {
      track: 'w-14 h-8',
      knob: 'w-6.5 h-6.5 top-[3px]',
      translate: 'translate-x-[26px]',
      baseTranslate: 'translate-x-[3px]',
    },
  }[size];

  // Background color variants matching app theme template
  const getActiveClass = () => {
    switch (color) {
      case 'emerald':
        return 'bg-emerald-500';
      case 'orange':
        return 'bg-[#ED6C35]';
      case 'blue':
        return 'bg-[#0091FF]';
      case 'theme':
      default:
        return 'bg-neutral-900 dark:bg-white/90';
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) {
          const nextVal = !checked;
          if (nextVal) {
            soundFx.switchOn();
          } else {
            soundFx.switchOff();
          }
          onChange(nextVal);
        }
      }}
      className={cn(
        'relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl focus-visible:ring-2 focus-visible:ring-neutral-900/50 dark:focus-visible:ring-white/50 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative block rounded-full transition-colors duration-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.10),0_1px_0_rgba(255,255,255,0.24)] ring-1 ring-inset ring-black/[0.06] dark:ring-white/10',
          sizeConfig.track,
          checked ? getActiveClass() : 'bg-black/10 dark:bg-white/15'
        )}
      >
        <span data-motion-thumb
          className={cn(
            'pointer-events-none absolute left-0 block rounded-full bg-white transition-transform duration-200 ease-out',
            sizeConfig.knob,
            checked ? sizeConfig.translate : sizeConfig.baseTranslate,
            checked && color === 'theme' && 'dark:bg-neutral-800'
          )}
          style={{
            boxShadow: '0 1px 3px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.9)',
          }}
        />
      </span>
    </button>
  );
};

export interface AppleCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  color?: 'black' | 'blue' | 'emerald' | 'theme';
}

/** A quiet material checkbox with filled check state when active. */
export const AppleCheckbox: React.FC<AppleCheckboxProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  label,
  className,
  ariaLabel,
  color = 'emerald',
}) => {
  const sizeConfig = {
    sm: {
      box: 'w-4 h-4 rounded-[5px]',
      icon: 11,
      text: 'text-xs',
    },
    md: {
      box: 'w-5 h-5 rounded-[6px]',
      icon: 13,
      text: 'text-xs sm:text-sm',
    },
    lg: {
      box: 'w-6 h-6 rounded-[7px]',
      icon: 15,
      text: 'text-sm sm:text-base',
    },
  }[size];

  const getCheckedClass = () => {
    switch (color) {
      case 'emerald':
        return 'bg-emerald-500 border-emerald-600 text-white shadow-xs';
      case 'blue':
        return 'bg-blue-500 border-blue-600 text-white shadow-xs';
      case 'black':
        return 'bg-neutral-900 border-neutral-950 text-white dark:bg-white dark:border-neutral-200 dark:text-neutral-950 shadow-xs';
      case 'theme':
      default:
        return 'bg-neutral-900 border-neutral-950 text-white dark:bg-white dark:border-neutral-200 dark:text-neutral-950 shadow-xs';
    }
  };

  return (
    <label
      className={cn(
        'inline-flex min-h-11 items-center gap-2 cursor-pointer select-none group',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={ariaLabel || (typeof label === 'string' ? label : 'Chọn')}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) {
            const nextVal = !checked;
            if (nextVal) {
              soundFx.switchOn();
            } else {
              soundFx.click();
            }
            onChange(nextVal);
          }
        }}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl cursor-pointer focus-visible:ring-2 focus-visible:ring-neutral-900/40 dark:focus-visible:ring-white/40"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center border transition-all duration-150',
            sizeConfig.box,
            checked
              ? getCheckedClass()
              : 'border-neutral-300 dark:border-neutral-600 bg-white/70 dark:bg-neutral-850 text-transparent hover:border-neutral-400 dark:hover:border-neutral-500 shadow-2xs'
          )}
        >
          {checked && <Check size={sizeConfig.icon} strokeWidth={3} className="shrink-0" />}
        </span>
      </button>

      {label && (
        <span
          className={cn(
            'kit-text-secondary font-medium group-hover:text-[var(--text-primary)] transition-colors',
            sizeConfig.text
          )}
        >
          {label}
        </span>
      )}
    </label>
  );
};
