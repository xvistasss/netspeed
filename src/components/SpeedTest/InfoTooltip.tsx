import React, { useState } from 'react';

interface InfoTooltipProps {
  content: string;
}

export default function InfoTooltip({ content }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center ml-1 z-20 group">
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        onClick={() => setVisible(!visible)}
        type="button"
        className="w-4 h-4 rounded-full border border-hairline-strong text-mute flex items-center justify-center text-[10px] font-mono hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary transition-[color,background-color,border-color] duration-150 cursor-pointer select-none"
        aria-label="More information"
      >
        i
      </button>
      {visible && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-64 bg-primary text-on-primary text-xs p-3 rounded-md shadow-lg border border-primary/20 z-50 transition-opacity duration-150 leading-relaxed font-sans text-left">
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-primary" />
          {content}
        </div>
      )}
    </div>
  );
}
