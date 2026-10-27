// Picks the reader for a dropped file. Everything runs in the browser except
// DWG, which our server converts to DXF (/api/dwg-convert, LibreDWG).

import { decodeTextSmart } from '../dxf/readTextSmart';
import type { CadDrawing } from './types';
import { readDxf } from './readers/dxf';
import { readSvg } from './readers/svg';

export const SUPPORTED_EXTENSIONS = ['dxf', 'dwg', 'svg', 'pdf', 'ifc', 'obj', 'glb', 'gltf'] as const;

export const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/**
 * A DWG converted through private storage (bucket cad-uploads, migration 20261027090000):
 * uploaded to the user's own folder, converted on our server, the DXF read back gzipped and
 * both files removed. Null when that isn't possible here (no one signed in, no bucket yet).
 */
async function convertViaStorage(buf: ArrayBuffer): Promise<string | null> {
  const { supabase } = await import('@/integrations/supabase/client');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const storage = supabase.storage.from('cad-uploads');
  const path = `${session.user.id}/${crypto.randomUUID()}.dwg`;
  const up = await storage.upload(path, new Blob([buf]), { contentType: 'application/octet-stream' });
  if (up.error) {
    // No cad-uploads bucket yet (migration 20261027090000): the direct way, for small drawings.
    if (/bucket not found|not found/i.test(up.error.message)) return null;
    throw new Error(`The DWG couldn't be uploaded: ${up.error.message}`);
  }
  const resp = await fetch('/api/dwg-convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ storagePath: path }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.dxfPath) {
    await storage.remove([path]).catch(() => {});
    throw new Error([json.error || 'DWG conversion failed.', json.hint].filter(Boolean).join(' '));
  }
  const { data, error } = await storage.download(json.dxfPath);
  void storage.remove([json.dxfPath]).catch(() => {});
  if (error || !data) throw new Error(`The converted drawing couldn't be downloaded: ${error?.message ?? 'missing'}`);
  return new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

export async function readCadFile(file: File): Promise<CadDrawing> {
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();
  switch (ext) {
    case 'dxf':
      return readDxf(decodeTextSmart(buf));
    case 'dwg': {
      // The hosted functions cap a request and its answer at ~4.5 MB, and a DWG's DXF is often ten
      // times the DWG: so a DWG goes through storage, and straight to the converter only when that
      // isn't set up yet (or no one is signed in) — fine for small drawings.
      const viaStorage = await convertViaStorage(buf);
      if (viaStorage !== null) return { ...readDxf(viaStorage), format: 'dwg', convertedDxf: viaStorage };
      const resp = await fetch('/api/dwg-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: buf,
      });
      if (resp.status === 413 || (resp.status >= 500 && buf.byteLength > 4.4 * 1024 * 1024)) {
        throw new Error(`This DWG (${(buf.byteLength / 1024 / 1024).toFixed(0)} MB) is too large to convert on the website until big uploads are set up (migration 20261027090000). In AutoCAD choose File → Save As → AutoCAD DXF and import the DXF instead.`);
      }
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error([json.error || 'DWG conversion failed.', json.hint].filter(Boolean).join(' '));
      return { ...readDxf(json.dxfText), format: 'dwg', convertedDxf: json.dxfText };
    }
    case 'svg':
      return readSvg(decodeTextSmart(buf));
    case 'pdf': {
      const { readPdf } = await import('./readers/pdf');
      return readPdf(buf);
    }
    case 'ifc': {
      const { readIfc } = await import('./readers/model3d');
      return readIfc(buf);
    }
    case 'obj': case 'glb': case 'gltf': {
      const { readModel } = await import('./readers/model3d');
      return readModel(buf, ext);
    }
    case 'dgn':
      // MicroStation V8 DGN is a proprietary format (an OLE container) with no
      // open specification or browser reader; MicroStation exports DWG/DXF.
      throw new Error('DGN files can\'t be read directly. In MicroStation choose File → Export → DWG or DXF, then import that file.');
    default:
      throw new Error(`.${ext || '?'} files can't be imported. Use DXF, DWG, SVG, PDF, IFC, OBJ, GLB or GLTF.`);
  }
}
