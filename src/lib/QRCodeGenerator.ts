/**
 * QRCodeGenerator — Admin utility for generating downloadable QR code images
 * that encode location anchor payloads.
 */

import QRCode from 'qrcode';

export interface QRGenerateOptions {
  nodeId: string;
  buildingId: string;
  floorId: string;
  size?: number;
}

/**
 * The link a QR code opens: the venue's View Map, starting at this place.
 * A link (not JSON) so any phone camera can open it without the app; the
 * in-app scanner understands both (see QRScanner.parsePayload).
 */
export function qrLink(options: Pick<QRGenerateOptions, 'nodeId' | 'buildingId' | 'floorId'>, origin = window.location.origin): string {
  const q = new URLSearchParams({ from: options.nodeId, floor: options.floorId });
  return `${origin}/venue/${encodeURIComponent(options.buildingId)}?${q}`;
}

/** Generate a QR code as a data URL (PNG). */
export async function generateQRCodeDataURL(options: QRGenerateOptions): Promise<string> {
  const payload = qrLink(options);

  return QRCode.toDataURL(payload, {
    width: options.size ?? 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}

/** Trigger a browser download of the QR code image. */
export async function downloadQRCode(options: QRGenerateOptions, filename?: string): Promise<void> {
  const dataUrl = await generateQRCodeDataURL(options);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename ?? `qr-${options.nodeId}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
