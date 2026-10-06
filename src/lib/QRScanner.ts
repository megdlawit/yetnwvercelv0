/**
 * QRScanner — Camera-based QR code scanner using jsQR.
 * Decodes QR payloads into structured location anchors.
 */

import jsQR from 'jsqr';

export interface QRAnchorPayload {
  buildingId: string;
  floorId: string;
  nodeId: string;
}

export type ScanStatus = 'idle' | 'scanning' | 'success' | 'error';

export class QRScanner {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private animFrame = 0;
  private _status: ScanStatus = 'idle';

  get status(): ScanStatus {
    return this._status;
  }

  /** Start camera and begin scanning. Calls onResult when a valid QR is found. */
  async start(
    videoElement: HTMLVideoElement,
    onResult: (payload: QRAnchorPayload) => void,
    onError?: (err: string) => void
  ): Promise<void> {
    this._status = 'scanning';

    try {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        throw new Error('Camera access is unavailable in this browser. Use a secure browser session and try again.');
      }

      this.stream = await mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });

      this.video = videoElement;
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', 'true');
      await this.video.play();

      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

      const scan = () => {
        if (!this.video || !this.ctx || !this.canvas) return;
        if (this.video.readyState !== this.video.HAVE_ENOUGH_DATA) {
          this.animFrame = requestAnimationFrame(scan);
          return;
        }

        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.ctx.drawImage(this.video, 0, 0);

        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code?.data) {
          const payload = this.parsePayload(code.data);
          if (payload) {
            this._status = 'success';
            this.stop();
            onResult(payload);
            return;
          }
        }

        this.animFrame = requestAnimationFrame(scan);
      };

      this.animFrame = requestAnimationFrame(scan);
    } catch (err) {
      this._status = 'error';
      const msg = err instanceof Error ? err.message : 'Camera access denied';
      onError?.(msg);
    }
  }

  stop(): void {
    cancelAnimationFrame(this.animFrame);
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this._status = 'idle';
  }

  private parsePayload(raw: string): QRAnchorPayload | null {
    // Current codes are View Map links (…/venue/<building>?from=<node>&floor=<floor>),
    // so a phone's own camera can open them; older printed codes are JSON.
    try {
      const url = new URL(raw);
      const building = /\/venue\/([^/?#]+)/.exec(url.pathname)?.[1];
      const nodeId = url.searchParams.get('from') ?? url.searchParams.get('entry');
      const floorId = url.searchParams.get('floor') ?? '';
      // The floor is optional — the spot alone (an id or a readable name) is enough.
      if (building && nodeId) return { buildingId: decodeURIComponent(building), floorId, nodeId };
    } catch { /* not a URL — try the JSON format */ }
    try {
      const data = JSON.parse(raw);
      if (data.buildingId && data.floorId && data.nodeId) {
        return {
          buildingId: String(data.buildingId),
          floorId: String(data.floorId),
          nodeId: String(data.nodeId),
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}
