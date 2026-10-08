// Picks the reader for a dropped file. Everything runs in the browser except
// DWG, which our server converts to DXF (/api/dwg-convert, LibreDWG).

import { decodeTextSmart } from '../dxf/readTextSmart';
import type { CadDrawing } from './types';
import { readDxf } from './readers/dxf';
import { readSvg } from './readers/svg';

export const SUPPORTED_EXTENSIONS = ['dxf', 'dwg', 'svg', 'pdf', 'ifc', 'obj', 'glb', 'gltf'] as const;

export const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

export async function readCadFile(file: File): Promise<CadDrawing> {
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();
  switch (ext) {
    case 'dxf':
      return readDxf(decodeTextSmart(buf));
    case 'dwg': {
      // Uploads go through a serverless function with a ~4.5 MB request limit.
      if (buf.byteLength > 4.4 * 1024 * 1024) {
        throw new Error('This DWG is too large to convert online. In AutoCAD choose File → Save As → AutoCAD DXF and import the DXF instead.');
      }
      const resp = await fetch('/api/dwg-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: buf,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error([json.error || 'DWG conversion failed.', json.hint].filter(Boolean).join(' '));
      return { ...readDxf(json.dxfText), format: 'dwg' };
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
