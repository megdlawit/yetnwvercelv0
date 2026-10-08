// Plan symbols for map features, drawn in world units (editor px) so they
// scale with the plan like real objects. `k` is world units per screen px,
// used only for hairline strokes and minimum visibility.

import { memo } from 'react';
import { FEATURE_KINDS, featureSize, type MapFeature } from '@/lib/venue/features';

interface Props { f: MapFeature; pxPerMeter: number; k: number; selected: boolean }

function FeatureGlyph({ f, pxPerMeter, k, selected }: Props) {
  const { w, d } = featureSize(f, pxPerMeter);
  const color = FEATURE_KINDS[f.kind]?.color ?? '#64748b';
  const stroke = { stroke: color, strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' as const, fill: 'none' };
  const hw = w / 2, hd = d / 2;
  let body: JSX.Element;
  switch (f.kind) {
    case 'door':
      // leaf + quarter swing, hinge at the left end
      body = (<>
        <line x1={-hw} y1={0} x2={-hw} y2={-w} {...stroke} />
        <path d={`M ${-hw} ${-w} A ${w} ${w} 0 0 1 ${hw} 0`} {...stroke} strokeDasharray="3 2" />
        <line x1={-hw} y1={0} x2={hw} y2={0} stroke="hsl(var(--background))" strokeWidth={4} vectorEffect="non-scaling-stroke" />
      </>);
      break;
    case 'arch':
      // an open gap in the wall with a rounded head
      body = (<>
        <line x1={-hw} y1={0} x2={hw} y2={0} stroke="hsl(var(--background))" strokeWidth={4} vectorEffect="non-scaling-stroke" />
        <path d={`M ${-hw} 0 Q 0 ${-w * 0.6} ${hw} 0`} {...stroke} />
      </>);
      break;
    case 'window':
      body = (<>
        <rect x={-hw} y={-hd} width={w} height={d} fill="hsl(var(--background))" {...stroke} />
        <line x1={-hw} y1={0} x2={hw} y2={0} {...stroke} />
      </>);
      break;
    case 'stairs': {
      const treads = Math.max(3, Math.round(d / (0.3 * pxPerMeter)));
      body = (<>
        <rect x={-hw} y={-hd} width={w} height={d} fill={`${color}18`} {...stroke} />
        {Array.from({ length: treads - 1 }, (_, i) => <line key={i} x1={-hw} x2={hw} y1={-hd + (d * (i + 1)) / treads} y2={-hd + (d * (i + 1)) / treads} {...stroke} strokeWidth={0.8} />)}
        <path d={`M 0 ${hd * 0.7} L 0 ${-hd * 0.7} M ${-w * 0.12} ${-hd * 0.5} L 0 ${-hd * 0.7} L ${w * 0.12} ${-hd * 0.5}`} {...stroke} />
      </>);
      break;
    }
    case 'elevator':
      body = (<>
        <rect x={-hw} y={-hd} width={w} height={d} fill={`${color}18`} {...stroke} />
        <path d={`M ${-hw} ${-hd} L ${hw} ${hd} M ${hw} ${-hd} L ${-hw} ${hd}`} {...stroke} strokeWidth={0.8} />
      </>);
      break;
    case 'entrance':
      body = (<>
        <circle r={Math.max(hw, 6 * k)} fill={`${color}22`} {...stroke} />
        <path d={`M ${-hw * 0.5} 0 L ${hw * 0.45} 0 M ${hw * 0.15} ${-hw * 0.3} L ${hw * 0.45} 0 L ${hw * 0.15} ${hw * 0.3}`} {...stroke} strokeWidth={2} />
      </>);
      break;
    case 'tree':
      body = (<>
        <circle r={hw} fill={`${color}30`} {...stroke} />
        <circle r={hw * 0.12} fill={color} />
      </>);
      break;
    case 'palm':
      // fronds radiating from the crown
      body = (<>
        <circle r={hw} fill={`${color}18`} stroke="none" />
        {Array.from({ length: 7 }, (_, i) => {
          const a = (i / 7) * Math.PI * 2;
          return <path key={i} d={`M 0 0 Q ${Math.cos(a + 0.35) * hw * 0.6} ${Math.sin(a + 0.35) * hw * 0.6} ${Math.cos(a) * hw} ${Math.sin(a) * hw}`} {...stroke} strokeWidth={2} />;
        })}
        <circle r={hw * 0.12} fill="#8a6a4c" />
      </>);
      break;
    case 'shrub':
      body = (<>
        {[[-0.3, 0.1], [0.3, 0.12], [0, -0.25]].map(([dx, dy], i) => <circle key={i} cx={dx * w} cy={dy * w} r={hw * 0.62} fill={`${color}40`} {...stroke} />)}
      </>);
      break;
    case 'flowers':
      body = (<>
        <rect x={-hw} y={-hd} width={w} height={d} rx={Math.min(w, d) * 0.4} fill="#8a6a4c22" {...stroke} stroke="#8a6a4c" />
        {Array.from({ length: 9 }, (_, i) => (
          <circle key={i} cx={-hw * 0.75 + (i % 5) * (w * 0.75) / 4 + (i >= 5 ? w * 0.09 : 0)} cy={i < 5 ? -hd * 0.35 : hd * 0.35} r={Math.min(w, d) * 0.12}
            fill={['#ec4899', '#facc15', '#f43f5e', '#a855f7'][i % 4]} />
        ))}
      </>);
      break;
    case 'grass':
      body = (<>
        <rect x={-hw} y={-hd} width={w} height={d} rx={Math.min(w, d) * 0.2} fill={`${color}33`} {...stroke} strokeDasharray="5 3" />
        {Array.from({ length: 5 }, (_, i) => <path key={i} d={`M ${-hw * 0.6 + i * w * 0.3 * 0.9} ${hd * 0.15} l ${w * 0.03} ${-d * 0.18} l ${w * 0.03} ${d * 0.18}`} {...stroke} strokeWidth={1} />)}
      </>);
      break;
    case 'water':
      body = (<>
        <ellipse rx={hw} ry={hd} fill={`${color}40`} {...stroke} />
        <path d={`M ${-hw * 0.5} 0 q ${w * 0.125} ${-d * 0.12} ${w * 0.25} 0 t ${w * 0.25} 0`} {...stroke} strokeWidth={1} />
      </>);
      break;
    case 'rock':
      body = <path d={`M ${-hw} ${hd * 0.3} L ${-hw * 0.5} ${-hd} L ${hw * 0.55} ${-hd * 0.8} L ${hw} ${hd * 0.2} L ${hw * 0.2} ${hd} Z`} fill={`${color}55`} {...stroke} />;
      break;
    case 'lamp':
      body = (<>
        <circle r={Math.max(hw * 4, 8 * k)} fill="#fde68a40" stroke="none" />
        <circle r={Math.max(hw, 3 * k)} fill={color} stroke="hsl(var(--background))" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </>);
      break;
    case 'fountain':
      body = (<>
        <circle r={hw} fill={`${color}22`} {...stroke} />
        <circle r={hw * 0.62} fill={`${color}40`} {...stroke} strokeWidth={1} />
        <circle r={hw * 0.15} fill={color} />
      </>);
      break;
    case 'planter':
      body = (<>
        <rect x={-hw} y={-hd} width={w} height={d} rx={Math.min(w, d) * 0.15} fill={`${color}30`} {...stroke} />
        <circle r={Math.min(hw, hd) * 0.6} fill="#4d7c0f55" stroke="#4d7c0f" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </>);
      break;
    case 'bench':
    case 'furniture':
      body = <rect x={-hw} y={-hd} width={w} height={d} rx={Math.min(w, d) * 0.15} fill={`${color}30`} {...stroke} />;
      break;
    case 'landmark':
      body = <path d={starPath(Math.max(hw, 6 * k))} fill={`${color}40`} {...stroke} />;
      break;
    case 'label':
      body = (
        <text fontSize={13 * k} textAnchor="middle" dominantBaseline="central" fill="hsl(var(--foreground))"
          stroke="hsl(var(--background))" strokeWidth={3 * k} paintOrder="stroke" className="font-medium">
          {f.label || 'Text'}
        </text>
      );
      break;
    default:
      // A kind this version doesn't know yet: a plain marker.
      body = <circle r={Math.max(hw, 6 * k)} fill={`${color}30`} {...stroke} />;
  }
  return (
    <g transform={`translate(${f.x} ${f.y}) rotate(${f.rotationDeg})`}>
      {selected && f.kind !== 'label' && (
        <rect x={-Math.max(hw, 6 * k) - 4 * k} y={-Math.max(hd, f.kind === 'door' ? w : 6 * k) - 4 * k}
          width={Math.max(w, 12 * k) + 8 * k} height={Math.max(d, 12 * k) + (f.kind === 'door' ? w : 0) + 8 * k}
          fill="hsl(var(--primary) / 0.12)" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      )}
      {selected && f.kind === 'label' && <rect x={-40 * k} y={-10 * k} width={80 * k} height={20 * k} fill="hsl(var(--primary) / 0.12)" stroke="hsl(var(--primary))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      {body}
    </g>
  );
}

function starPath(r: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    return `${i ? 'L' : 'M'} ${(Math.cos(a) * rr).toFixed(2)} ${(Math.sin(a) * rr).toFixed(2)}`;
  }).join(' ') + ' Z';
}

export default memo(FeatureGlyph);
