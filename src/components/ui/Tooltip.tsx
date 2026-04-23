import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { workspaceMenuSurfaceStyle } from "@/components/workspace/chrome/workspaceMenuChrome";
import { workspaceTooltipZ } from "@/lib/workspaceFloatingLayer";

type TooltipPosition = "top" | "bottom";

interface TooltipCoords {
  top: number;
  left: number;
  arrowLeft: number;
  actualPosition: TooltipPosition;
}

interface TooltipProps {
  targetRef: React.RefObject<HTMLElement | null>;
  position?: TooltipPosition;
  children: React.ReactNode;
}

const TOOLTIP_WIDTH = 200;
const VIEWPORT_PADDING = 12;
const GAP = 8;
const ARROW_MARGIN = 12;
const DEFAULT_HEIGHT = 60;

export const Tooltip: React.FC<TooltipProps> = ({
  targetRef,
  position = "top",
  children,
}) => {
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!targetRef.current) return;

    const targetRect = targetRef.current.getBoundingClientRect();
    const tooltipHeight = tooltipRef.current?.offsetHeight || DEFAULT_HEIGHT;

    let actualPosition = position;
    let top: number;

    if (position === "top") {
      const spaceAbove = targetRect.top - tooltipHeight - GAP;
      if (spaceAbove < VIEWPORT_PADDING) {
        actualPosition = "bottom";
        top = targetRect.bottom + GAP;
      } else {
        top = targetRect.top - GAP - tooltipHeight;
      }
    } else {
      const spaceBelow =
        window.innerHeight - targetRect.bottom - tooltipHeight - GAP;
      if (spaceBelow < VIEWPORT_PADDING) {
        actualPosition = "top";
        top = targetRect.top - GAP - tooltipHeight;
      } else {
        top = targetRect.bottom + GAP;
      }
    }

    const targetCenter = targetRect.left + targetRect.width / 2;
    let left = targetCenter - TOOLTIP_WIDTH / 2;

    if (left < VIEWPORT_PADDING) {
      left = VIEWPORT_PADDING;
    } else if (left + TOOLTIP_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
      left = window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_PADDING;
    }

    const arrowLeft = Math.min(
      Math.max(targetCenter - left, ARROW_MARGIN),
      TOOLTIP_WIDTH - ARROW_MARGIN,
    );

    setCoords({ top, left, arrowLeft, actualPosition });
  }, [targetRef, position]);

  useEffect(() => {
    updatePosition();

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [updatePosition]);

  const tooltipZ = Number.parseInt(workspaceTooltipZ(), 10) || 12060;

  const arrowStyle: React.CSSProperties =
    coords?.actualPosition === "top"
      ? {
          position: "absolute",
          bottom: -6,
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: "6px solid var(--workspace-border-strong)",
        }
      : {
          position: "absolute",
          top: -6,
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderBottom: "6px solid var(--workspace-border-strong)",
        };

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        ...workspaceMenuSurfaceStyle(),
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        width: TOOLTIP_WIDTH,
        zIndex: tooltipZ,
        opacity: coords ? 1 : 0,
        padding: "8px 12px",
        color: "var(--workspace-text)",
        fontSize: 13,
        lineHeight: 1.45,
        boxShadow: "var(--workspace-shadow-soft)",
        /* Allow pointer-arrow to extend past the rounded rect (menu surface defaults to overflow:hidden). */
        overflow: "visible",
      }}
      className="whitespace-normal transition-opacity duration-150"
    >
      {children}
      <div
        style={{
          ...arrowStyle,
          left: coords?.arrowLeft ?? 0,
          transform: "translateX(-50%)",
        }}
        aria-hidden
      />
    </div>,
    document.body,
  );
};
