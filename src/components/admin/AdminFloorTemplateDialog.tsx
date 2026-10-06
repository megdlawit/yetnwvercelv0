import React, { useState, useEffect } from 'react';
import { Layers, Check } from 'lucide-react';
import AdminDialogShell from './AdminDialogShell';
import { AdminButtonPrimary, AdminButtonGhost } from './AdminButtons';
import { FLOOR_TEMPLATES, type FloorTemplate } from '@/lib/floorTemplates';

interface AdminFloorTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingName?: string;
  submitting?: boolean;
  onConfirm: (templateId: string) => void;
}

/** Small static preview of a template's layout, scaled into a 96×64 thumbnail. */
const TemplatePreview: React.FC<{ template: FloorTemplate; selected: boolean }> = ({ template, selected }) => {
  const nodeByKey = Object.fromEntries(template.nodes.map(n => [n.key, n]));
  return (
    <svg viewBox="0 0 800 500" className="w-full h-16 rounded-xl" style={{ background: selected ? 'hsl(152 70% 22% / 0.06)' : 'hsl(var(--muted))' }}>
      {template.nodes.length === 0 ? (
        <text x="400" y="260" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 48, fontWeight: 700 }}>
          +
        </text>
      ) : (
        <>
          {template.edges.map((e, i) => {
            const from = nodeByKey[e.from];
            const to = nodeByKey[e.to];
            if (!from || !to) return null;
            return (
              <line
                key={i}
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={selected ? 'hsl(152 70% 30%)' : 'hsl(var(--muted-foreground))'}
                strokeWidth={10}
                strokeLinecap="round"
                opacity={0.5}
              />
            );
          })}
          {template.nodes.map(n => (
            <circle
              key={n.key}
              cx={n.x} cy={n.y}
              r={n.isHallway ? 16 : 22}
              fill={selected ? 'hsl(133 60% 42%)' : 'hsl(var(--muted-foreground))'}
              opacity={n.isHallway ? 0.55 : 0.9}
            />
          ))}
        </>
      )}
    </svg>
  );
};

const AdminFloorTemplateDialog: React.FC<AdminFloorTemplateDialogProps> = ({
  open, onOpenChange, buildingName, submitting, onConfirm,
}) => {
  const [selectedId, setSelectedId] = useState('blank');

  useEffect(() => {
    if (open) setSelectedId('blank');
  }, [open]);

  return (
    <AdminDialogShell
      open={open}
      onOpenChange={onOpenChange}
      icon={Layers}
      title="Choose a floor template"
      description={buildingName ? `Add a new floor to ${buildingName}` : 'Pick a starting layout for the new floor'}
      maxWidth="sm:max-w-lg"
      footer={
        <>
          <AdminButtonGhost onClick={() => onOpenChange(false)}>Cancel</AdminButtonGhost>
          <AdminButtonPrimary onClick={() => onConfirm(selectedId)} loading={submitting}>
            {selectedId === 'blank' ? 'Add blank floor' : 'Add floor from template'}
          </AdminButtonPrimary>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        {FLOOR_TEMPLATES.map(t => {
          const selected = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className="text-left rounded-2xl p-2.5 transition-colors relative"
              style={{
                border: `1.5px solid ${selected ? 'hsl(152 70% 30%)' : 'hsl(var(--border))'}`,
                background: selected ? 'hsl(152 70% 22% / 0.04)' : 'transparent',
              }}
            >
              {selected && (
                <div
                  className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: 'hsl(152 70% 22%)' }}
                >
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
              <TemplatePreview template={t} selected={selected} />
              <p className="text-xs font-bold mt-2 pr-5 leading-tight">{t.name}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{t.description}</p>
            </button>
          );
        })}
      </div>
    </AdminDialogShell>
  );
};

export default AdminFloorTemplateDialog;
