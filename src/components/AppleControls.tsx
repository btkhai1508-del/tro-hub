import React from 'react';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';
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

/**
 * Apple-style Skeuomorphic Switch Toggle
 * Designed accurately from Figma specs:
 * Off: #EEEEEE background, #ECECEC knob with -1px 14px 18px rgba(0,0,0,0.35) shadow
 * On: Theme color background, #ECECEC knob translated to right
 */
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
        return 'bg-emerald-500 shadow-inner shadow-emerald-700/20';
      case 'orange':
        return 'bg-[#ED6C35] shadow-inner shadow-amber-900/20';
      case 'blue':
        return 'bg-blue-600 shadow-inner shadow-blue-800/20';
      case 'theme':
      default:
        return 'bg-neutral-900 dark:bg-white/90 shadow-inner shadow-black/15';
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
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-neutral-900/50 dark:focus-visible:ring-white/50 cursor-pointer select-none',
        sizeConfig.track,
        checked
          ? getActiveClass()
          : 'bg-black/10 dark:bg-white/15 shadow-inner shadow-black/10',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      style={{
        borderRadius: '190px',
      }}
    >
      <span
        className={cn(
          'pointer-events-none absolute block rounded-full transition-transform duration-200 ease-out',
          sizeConfig.knob,
          checked ? sizeConfig.translate : sizeConfig.baseTranslate
        )}
        style={{
          background: '#ECECEC',
          boxShadow: '-0.5px 3px 6px rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0,0,0,0.15)',
        }}
      />
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
  color?: 'black' | 'blue' | 'theme';
}

/**
 * Skeuomorphic Inset Checkbox
 * Designed per Apple & modern skeuomorphism specs:
 * Unchecked: subtle inset bevel
 * Checked: Pitch black or theme gradient, inset shadow, with crisp white inner mark
 */
export const AppleCheckbox: React.FC<AppleCheckboxProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  label,
  className,
  ariaLabel = 'Checkbox',
  color = 'black',
}) => {
  const sizeConfig = {
    sm: {
      box: 'w-4 h-4 rounded-md',
      inner: 'w-2 h-2 rounded-[2px]',
      icon: 11,
      text: 'text-xs',
    },
    md: {
      box: 'w-5 h-5 rounded-[7px]',
      inner: 'w-2.5 h-2.5 rounded-[3px]',
      icon: 13,
      text: 'text-xs sm:text-sm',
    },
    lg: {
      box: 'w-6 h-6 rounded-lg',
      inner: 'w-3 h-3 rounded-[4px]',
      icon: 15,
      text: 'text-sm',
    },
  }[size];

  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 cursor-pointer select-none group',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <button
        type="button"
        role="checkbox"
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
              soundFx.click();
            }
            onChange(nextVal);
          }
        }}
        className={cn(
          'relative shrink-0 flex items-center justify-center transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/40 dark:focus-visible:ring-white/40',
          sizeConfig.box
        )}
        style={{
          background: checked
            ? color !== 'blue'
              ? 'linear-gradient(141.47deg, #09090b 24.4%, #27272a 75.04%)'
              : 'linear-gradient(141.47deg, #2563EB 24.4%, #60A5FA 75.04%)'
            : 'linear-gradient(141.47deg, #D9D9D9 24.4%, #FFFFFF 75.04%)',
          boxShadow: checked
            ? color !== 'blue'
              ? 'inset 0px 2px 3px rgba(0, 0, 0, 0.75), 0 1px 2px rgba(0,0,0,0.3)'
              : 'inset 0px 2px 3px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(37,99,235,0.2)'
            : 'inset 0px 2px 3px rgba(0, 0, 0, 0.45)',
        }}
      >
        {checked && (
          <Check
            size={sizeConfig.icon}
            strokeWidth={3.2}
            className="text-white drop-shadow-[-0.6px_1.5px_2px_rgba(0,0,0,0.5)] animate-in zoom-in-75 duration-150"
          />
        )}
      </button>

      {label && (
        <span
          className={cn(
            'text-neutral-700 dark:text-neutral-200 font-medium group-hover:text-neutral-900 dark:group-hover:text-white transition-colors',
            sizeConfig.text
          )}
        >
          {label}
        </span>
      )}
    </label>
  );
};
