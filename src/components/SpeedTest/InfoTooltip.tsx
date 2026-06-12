import React, { useState, useEffect, useRef, useId } from 'react';

interface InfoTooltipProps {
  content: string;
}

export default function InfoTooltip({ content }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [xOffset, setXOffset] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  // Dynamic positioning calculation to prevent viewport overflow
  useEffect(() => {
    if (!visible) {
      setXOffset(0);
      return;
    }

    const adjustPosition = () => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      // Reset transform temporarily to measure natural bounding rect
      tooltip.style.transform = 'translate(-50%, 0)';

      const rect = tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const margin = 12; // safety margin from viewport edges

      let shift = 0;
      if (rect.left < margin) {
        shift = margin - rect.left;
      } else if (rect.right > viewportWidth - margin) {
        shift = viewportWidth - margin - rect.right;
      }

      setXOffset(shift);
    };

    const animId = requestAnimationFrame(adjustPosition);

    window.addEventListener('resize', adjustPosition);
    window.addEventListener('scroll', adjustPosition, { passive: true });

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', adjustPosition);
      window.removeEventListener('scroll', adjustPosition);
    };
  }, [visible]);

  // Click outside to dismiss the tooltip on mobile and desktop
  useEffect(() => {
    if (!visible) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true });

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [visible]);

  return (
    <div ref={containerRef} className="relative inline-flex items-center ml-1 z-20 group">
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        onClick={() => setVisible(!visible)}
        type="button"
        className="w-4 h-4 rounded-full border border-hairline-strong text-mute flex items-center justify-center text-[10px] font-mono hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary transition-[color,background-color,border-color] duration-150 cursor-pointer select-none"
        aria-label="More information"
        aria-describedby={tooltipId}
        aria-expanded={visible}
      >
        i
      </button>
      {visible && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={{
            transform: `translate(calc(-50% + ${xOffset}px), 0)`,
          }}
          className="absolute bottom-6 left-1/2 w-64 bg-primary text-on-primary text-xs p-3 rounded-md shadow-lg border border-primary/20 z-50 transition-opacity duration-150 leading-relaxed font-sans text-left"
        >
          <div
            style={{
              left: `clamp(12px, calc(50% - ${xOffset}px), 244px)`,
            }}
            className="absolute top-full -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-primary"
          />
          {content}
        </div>
      )}
    </div>
  );
}

