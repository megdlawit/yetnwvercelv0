import React, { useEffect, useState } from 'react';
import { Copy, Check, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import AdminField, { ADMIN_INPUT_CLS } from '@/components/admin/AdminField';
import { AdminButtonPrimary } from '@/components/admin/AdminButtons';
import { admin } from '@/components/admin/adminTheme';

interface PartnerKeyRow {
  id: string;
  partner_name: string;
  api_key: string;
  allowed_building_ids: string[] | null;
  is_active: boolean;
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `pk_live_${hex}`;
}

const CodeBlock: React.FC<{ label: string; code: string }> = ({ label, code }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-semibold" style={{ color: admin.text }}>{label}</span>
        <button
          onClick={copy}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium flex items-center gap-1.5 transition-colors"
          style={{ background: copied ? admin.accent : admin.surface, color: copied ? '#fff' : admin.text, border: `1px solid ${admin.border}` }}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className="text-[12px] font-mono whitespace-pre-wrap break-all rounded-lg p-3"
        style={{ background: admin.surfaceSunken, border: `1px solid ${admin.border}`, color: admin.textMuted }}
      >
        {code}
      </pre>
    </div>
  );
};

interface BuildingEmbedPanelProps {
  buildingId: string;
}

/**
 * Embed-code generator for one specific building. Pulled out of AdminEmbed
 * so the exact same picker + generate + copy flow can also open as a
 * per-building dialog (the "click a building, get its embed code" flow,
 * same idea as Google Maps' per-location Share button) instead of only
 * living behind a separate tab with its own building dropdown.
 */
const BuildingEmbedPanel: React.FC<BuildingEmbedPanelProps> = ({ buildingId }) => {
  const [keys, setKeys] = useState<PartnerKeyRow[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase
      .from('partner_keys')
      .select('id, partner_name, api_key, allowed_building_ids, is_active')
      .eq('is_active', true)
      .then(({ data, error }) => {
        if (error) { toast.error('Failed to load partner keys'); return; }
        setKeys(data ?? []);
        setLoaded(true);
      });
  }, []);

  const keysForBuilding = keys.filter(
    (k) => !k.allowed_building_ids || k.allowed_building_ids.length === 0 || k.allowed_building_ids.includes(buildingId)
  );

  useEffect(() => {
    if (loaded && !keysForBuilding.find((k) => k.id === selectedKeyId)) {
      setSelectedKeyId(keysForBuilding[0]?.id ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId, keys, loaded]);

  const handleGenerate = async () => {
    if (!partnerName.trim()) { toast.error('Enter a partner name for this key'); return; }
    setGenerating(true);
    const { data, error } = await supabase
      .from('partner_keys')
      .insert({ partner_name: partnerName.trim(), api_key: generateApiKey(), allowed_building_ids: [buildingId] })
      .select('id, partner_name, api_key, allowed_building_ids, is_active')
      .single();
    setGenerating(false);
    if (error?.code === '42501') {
      // RLS: only institution owners/members may manage keys (20260930130000_partner_keys_lockdown.sql).
      toast.error('Only an institution owner or member can create partner keys. Ask the platform owner to add your account to the venue\'s institution.');
      return;
    }
    if (error || !data) { toast.error(error?.message ?? 'Failed to generate key'); return; }
    toast.success('Key generated');
    setKeys((prev) => [...prev, data]);
    setSelectedKeyId(data.id);
    setPartnerName('');
  };

  const selectedKey = keys.find((k) => k.id === selectedKeyId);
  const origin = window.location.origin;

  const iframeSnippet = selectedKey
    ? `<iframe\n  src="${origin}/embed?key=${selectedKey.api_key}&building=${buildingId}"\n  style="width:100%;height:480px;border:0"\n  loading="lazy"\n></iframe>`
    : '';

  const scriptSnippet = selectedKey
    ? `<div id="map" style="width:100%;height:480px"></div>\n<script src="${origin}/embed.js"></script>\n<script>\n  EthiMaps.render('#map', {\n    apiKey: '${selectedKey.api_key}',\n    buildingId: '${buildingId}',\n  });\n</script>`
    : '';

  return (
    <div>
      <AdminField label="Partner key">
        {keysForBuilding.length > 0 ? (
          <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
            <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue placeholder="Select a key" /></SelectTrigger>
            <SelectContent>
              {keysForBuilding.map((k) => (
                <SelectItem key={k.id} value={k.id}>{k.partner_name} — {k.api_key.slice(0, 14)}…</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-[13px]" style={{ color: admin.textFaint }}>No key yet for this building — generate one below.</p>
        )}
      </AdminField>

      <div className="h-4" />

      <div className="flex items-end gap-2 mb-6 p-3 rounded-lg" style={{ background: admin.surfaceSunken, border: `1px solid ${admin.border}` }}>
        <div className="flex-1">
          <AdminField label="New partner name">
            <Input
              className={ADMIN_INPUT_CLS}
              placeholder="e.g. Ethiopian Airlines"
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
            />
          </AdminField>
        </div>
        <AdminButtonPrimary onClick={handleGenerate} loading={generating}>
          <KeyRound className="w-3.5 h-3.5" /> Generate key
        </AdminButtonPrimary>
      </div>

      {selectedKey && (
        <div className="space-y-5">
          <CodeBlock label="Option A — iframe (no code, any website)" code={iframeSnippet} />
          <CodeBlock label="Option B — script tag (partner controls their own CSS)" code={scriptSnippet} />
        </div>
      )}
    </div>
  );
};

export default BuildingEmbedPanel;
