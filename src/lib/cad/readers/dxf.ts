import { parseDxf, unitsFromInsunits } from '../../dxf/parseDxf';
import type { CadDrawing } from '../types';

export function readDxf(text: string): CadDrawing {
  const parsed = parseDxf(text);
  const declared = unitsFromInsunits(parsed.insunits);
  return {
    ...parsed,
    format: 'dxf',
    unitsPerMeter: declared?.perMeter ?? null,
    unitsName: declared ? `${declared.name} (from the file)` : 'unknown',
    flipY: true,
    notes: declared ? [] : ['The file does not declare its units; millimetres are assumed (the usual CAD default).'],
  };
}
