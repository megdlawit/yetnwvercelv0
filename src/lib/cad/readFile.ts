// Picks the reader for a dropped file. Everything runs in the browser except
// DWG, which has no open specification and goes through /api/dwg-convert.

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
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const resp = await fetch('/api/dwg-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dwgBase64: btoa(bin), fileName: file.name }),
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
