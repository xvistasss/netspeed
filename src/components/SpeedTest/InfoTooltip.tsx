import { useState, useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";

interface InfoTooltipProps {
  content: string;
}

export default function InfoTooltip({ content }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!visible) {
      return;
    }

    const adjustPosition = () => {
      const tooltip = tooltipRef.current;
      const container = containerRef.current;
      if (!tooltip || !container) return;

      const triggerRect = container.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const margin = 8;
      const gap = 12;

      const tooltipW = tooltipRect.width || 256;
      const tooltipH = tooltipRect.height || 80;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const header = document.querySelector("header");
      const headerH = header ? header.getBoundingClientRect().height : 0;

      // Horizontal: center on trigger, clamp to viewport
      let x = triggerRect.left + triggerRect.width / 2 - tooltipW / 2;
      if (x < margin) x = margin;
      if (x + tooltipW > vw - margin) x = vw - margin - tooltipW;

      // Vertical: prefer above, flip below if not enough room
      const spaceAbove = triggerRect.top - gap - headerH;
      const spaceBelow = vh - triggerRect.bottom - gap;

      let y: number;
      let pos: "top" | "bottom";

      if (spaceAbove >= tooltipH + margin) {
        y = triggerRect.top - gap - tooltipH;
        pos = "top";
      } else if (spaceBelow >= tooltipH + margin) {
        y = triggerRect.bottom + gap;
        pos = "bottom";
      } else if (spaceBelow >= spaceAbove) {
        y = triggerRect.bottom + gap;
        pos = "bottom";
        // Clamp so bottom edge stays in viewport
        if (y + tooltipH > vh - margin) y = vh - margin - tooltipH;
      } else {
        y = triggerRect.top - gap - tooltipH;
        pos = "top";
        // Clamp so top edge stays below the header
        if (y < headerH + margin) y = headerH + margin;
      }

      setPos({ x, y });
    };

    const animId = requestAnimationFrame(adjustPosition);
    window.addEventListener("resize", adjustPosition);
    window.addEventListener("scroll", adjustPosition, { passive: true });

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", adjustPosition);
      window.removeEventListener("scroll", adjustPosition);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node)
      ) {
        setVisible(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick, {
      passive: true,
    });

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [visible]);

  // Close the tooltip automatically on scroll (prevents position jumping on mobile)
  useEffect(() => {
    if (!visible) return;

    const handleScroll = () => {
      setVisible(false);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center ml-1 group"
    >
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
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
            }}
            className="w-64 bg-primary text-on-primary text-xs p-3 rounded-md shadow-lg border border-primary/20 z-[9999] transition-opacity duration-150 leading-relaxed font-sans text-left"
          >
            {content}
          </div>,
          document.body
        )}
    </div>
  );
}
