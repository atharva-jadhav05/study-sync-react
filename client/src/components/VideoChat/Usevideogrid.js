import { useState, useEffect, useRef, useMemo } from 'react';

const ASPECT = 16 / 9;
const GAP    = 8;   // px between tiles
const PAD    = 12;  // container padding (all sides)

/**
 * LAYOUT DEFINITIONS
 * Each number key = total tile count.
 * Value = array of row sizes (tiles per row).
 *
 * Rules:
 *   1 → [1]           centered single
 *   2 → [2]           side-by-side
 *   3 → [2, 1]        2 top, 1 bottom centered
 *   4 → [2, 2]        2×2
 *   5 → [3, 2]        3 top, 2 bottom centered
 *   6 → [3, 3]        3×2
 */
export const LAYOUT_ROWS = {
  0: [],
  1: [1],
  2: [2],
  3: [2, 1],
  4: [2, 2],
  5: [3, 2],
  6: [3, 3],
};

export const TILES_PER_PAGE = 6;

/**
 * Given container dimensions and a row-definition array,
 * compute the largest tile size (px) that fits while keeping 16:9.
 *
 * @param {number} containerW
 * @param {number} containerH
 * @param {number[]} rowDef   e.g. [3, 2]
 * @returns {{ tileW: number, tileH: number }}
 */
export function computeTileSize(containerW, containerH, rowDef) {
  if (!rowDef || rowDef.length === 0) return { tileW: 0, tileH: 0 };

  const numRows = rowDef.length;
  const maxCols = Math.max(...rowDef);

  // Available space after padding and inter-tile gaps
  const availW = containerW - PAD * 2 - GAP * (maxCols - 1);
  const availH = containerH - PAD * 2 - GAP * (numRows - 1);

  // Start: constrain by width
  let tileW = availW / maxCols;
  let tileH = tileW / ASPECT;

  // If total height overflows, constrain by height instead
  if (tileH * numRows > availH) {
    tileH = availH / numRows;
    tileW = tileH * ASPECT;
  }

  return {
    tileW: Math.max(0, Math.floor(tileW)),
    tileH: Math.max(0, Math.floor(tileH)),
  };
}

/**
 * useGridLayout
 *
 * Watches a container via ResizeObserver, computes tile dimensions,
 * and manages pagination state.
 *
 * @param {number} totalTiles  Total tiles to display (local + remote)
 * @returns {object}
 */
export function useGridLayout(totalTiles) {
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [page, setPage] = useState(0);
  const [pinnedId, setPinnedId] = useState(null);

  // ── ResizeObserver ─────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observe = () => {
      const { width, height } = el.getBoundingClientRect();
      setContainerSize({ w: Math.floor(width), h: Math.floor(height) });
    };

    const ro = new ResizeObserver(observe);
    ro.observe(el);
    observe(); // measure immediately

    return () => ro.disconnect();
  }, []);

  // ── Pagination ─────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(totalTiles / TILES_PER_PAGE));

  // Clamp page if participants leave
  useEffect(() => {
    setPage(p => Math.min(p, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  const canGoPrev = page > 0;
  const canGoNext = page < totalPages - 1;

  // ── Tile window for current page ───────────────────────
  const startIdx = page * TILES_PER_PAGE;
  const endIdx   = Math.min(startIdx + TILES_PER_PAGE, totalTiles);
  const tilesOnPage = endIdx - startIdx; // how many tiles actually on this page

  // ── Row definition & tile size ─────────────────────────
  const rowDef = LAYOUT_ROWS[tilesOnPage] ?? LAYOUT_ROWS[6];

  const { tileW, tileH } = useMemo(
    () => computeTileSize(containerSize.w, containerSize.h, rowDef),
    [containerSize.w, containerSize.h, rowDef]
  );

  // ── Pinned layout tile sizes ───────────────────────────
  // Sidebar thumbnails: fixed 160px wide, 16:9
  const thumbW = containerSize.w < 768 ? 110 : 152;
  const thumbH = Math.floor(thumbW / ASPECT);

  // Main pinned area (full container minus sidebar)
  const sidebarTotalW = thumbW + PAD + GAP;
  const pinnedW = containerSize.w - (containerSize.w < 768 ? 0 : sidebarTotalW);
  const pinnedH = containerSize.w < 768
    ? Math.floor(containerSize.h * 0.6)
    : containerSize.h;

  return {
    containerRef,
    containerSize,
    // layout
    rowDef,
    tileW,
    tileH,
    // pinned
    pinnedId,
    setPinnedId,
    thumbW,
    thumbH,
    pinnedW,
    pinnedH,
    sidebarTotalW,
    // pagination
    page,
    totalPages,
    startIdx,
    endIdx,
    tilesOnPage,
    canGoPrev,
    canGoNext,
    goNext: () => setPage(p => Math.min(p + 1, totalPages - 1)),
    goPrev: () => setPage(p => Math.max(p - 1, 0)),
    // constants
    GAP,
    PAD,
  };
}