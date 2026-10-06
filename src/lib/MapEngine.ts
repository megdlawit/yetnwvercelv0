/**
 * MapEngine — SVG map viewport management.
 * Handles zoom, pan, and coordinate transforms while maintaining
 * real-world scale (1 unit = 1 meter).
 */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.2;
const MIN_ZOOM = 50;
const MAX_ZOOM = 5000;

export class MapEngine {
  private viewBox: ViewBox;
  private readonly defaultViewBox: ViewBox;

  constructor(mapWidth: number, mapHeight: number, padding = 20) {
    this.defaultViewBox = {
      x: -padding,
      y: -padding,
      w: mapWidth + padding * 2,
      h: mapHeight + padding * 2,
    };
    this.viewBox = { ...this.defaultViewBox };
  }

  getViewBox(): ViewBox {
    return { ...this.viewBox };
  }

  getViewBoxString(): string {
    return `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`;
  }

  reset(): ViewBox {
    this.viewBox = { ...this.defaultViewBox };
    return this.getViewBox();
  }

  zoomIn(): ViewBox {
    return this.zoom(ZOOM_IN_FACTOR);
  }

  zoomOut(): ViewBox {
    return this.zoom(ZOOM_OUT_FACTOR);
  }

  zoom(factor: number): ViewBox {
    const newW = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewBox.w * factor));
    const newH = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewBox.h * factor));
    const cx = this.viewBox.x + this.viewBox.w / 2;
    const cy = this.viewBox.y + this.viewBox.h / 2;
    this.viewBox = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
    return this.getViewBox();
  }

  /** Pan by pixel delta relative to container size. */
  pan(dxPx: number, dyPx: number, containerWidth: number, containerHeight: number): ViewBox {
    const dx = (dxPx / containerWidth) * this.viewBox.w;
    const dy = (dyPx / containerHeight) * this.viewBox.h;
    this.viewBox.x -= dx;
    this.viewBox.y -= dy;
    return this.getViewBox();
  }

  /** Center viewport on a coordinate. */
  centerOn(x: number, y: number): ViewBox {
    this.viewBox.x = x - this.viewBox.w / 2;
    this.viewBox.y = y - this.viewBox.h / 2;
    return this.getViewBox();
  }

  /** Convert screen pixel to SVG coordinate. */
  screenToSvg(
    screenX: number,
    screenY: number,
    containerRect: DOMRect
  ): { x: number; y: number } {
    return {
      x: this.viewBox.x + (screenX - containerRect.left) / containerRect.width * this.viewBox.w,
      y: this.viewBox.y + (screenY - containerRect.top) / containerRect.height * this.viewBox.h,
    };
  }
}
