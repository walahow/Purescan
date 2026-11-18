import React from 'react';

interface DraftingFrameProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * HYDE's signature extended intersecting hairline crop-mark frame.
 */
export function DraftingFrame({ children, className = '' }: DraftingFrameProps) {
  return (
    <div className={`relative ${className}`}>
      <div className="pointer-events-none absolute top-0 -left-3 -right-1.5 h-px bg-zinc-300 z-10 hidden sm:block" />
      <div className="pointer-events-none absolute -top-3 -bottom-1.5 left-0 w-px bg-zinc-300 z-10 hidden sm:block" />
      <div className="pointer-events-none absolute -top-1.5 -bottom-3 right-0 w-px bg-zinc-300 z-10 hidden sm:block" />
      <div className="pointer-events-none absolute bottom-0 -left-1.5 -right-3 h-px bg-zinc-300 z-10 hidden sm:block" />
      {children}
    </div>
  );
}

interface CornerTickButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

/**
 * HYDE-style sharp button with subtle hover corner brackets on desktop.
 */
export function CornerTickButton({
  children,
  variant = 'primary',
  className = '',
  disabled,
  ...rest
}: CornerTickButtonProps) {
  const baseStyle =
    variant === 'primary'
      ? 'bg-zinc-900 text-white border border-zinc-900 hover:bg-zinc-800 active:bg-black'
      : 'bg-white text-zinc-900 border border-zinc-300 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 active:bg-zinc-800';

  return (
    <div className="relative group/cta">
      <div className="pointer-events-none absolute -top-1.5 -left-3 w-8 h-px bg-zinc-300 transition-all group-hover/cta:w-12 group-hover/cta:bg-zinc-500 hidden md:block" />
      <div className="pointer-events-none absolute -top-3 -left-1.5 w-px h-8 bg-zinc-300 transition-all group-hover/cta:h-12 group-hover/cta:bg-zinc-500 hidden md:block" />
      <div className="pointer-events-none absolute -bottom-1.5 -right-3 w-8 h-px bg-zinc-300 transition-all group-hover/cta:w-12 group-hover/cta:bg-zinc-500 hidden md:block" />
      <div className="pointer-events-none absolute -bottom-3 -right-1.5 w-px h-8 bg-zinc-300 transition-all group-hover/cta:h-12 group-hover/cta:bg-zinc-500 hidden md:block" />
      <button
        disabled={disabled}
        className={`relative z-10 w-full rounded-none font-mono font-bold tracking-[0.16em] text-[11px] uppercase flex items-center justify-center gap-2.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${baseStyle} ${className}`}
        {...rest}
      >
        {children}
      </button>
    </div>
  );
}
