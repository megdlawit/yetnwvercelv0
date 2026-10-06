/**
 * AdminEmbed — "Embed" tab in the admin console.
 *
 * Pick a building, then BuildingEmbedPanel handles picking/generating a
 * partner key and showing ready-to-copy snippets. Same panel also opens
 * as a per-building dialog directly from AdminBuildings — see the "Get
 * embed code" button there for the Google-Maps-share-button-style flow.
 */
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AdminField, { ADMIN_INPUT_CLS } from '@/components/admin/AdminField';
import { admin } from '@/components/admin/adminTheme';
import BuildingEmbedPanel from '@/components/admin/BuildingEmbedPanel';

interface BuildingOption { id: string; name: string; }

const AdminEmbed: React.FC = () => {
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState('');

  useEffect(() => {
    supabase.from('buildings').select('id, name').then(({ data, error }) => {
      if (error) { toast.error('Failed to load buildings'); return; }
      setBuildings(data ?? []);
      if ((data ?? []).length) setSelectedBuildingId((prev) => prev || data![0].id);
    });
  }, []);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-[15px] font-semibold mb-1" style={{ color: admin.text }}>Embed this map on a partner site</h2>
        <p className="text-[13px]" style={{ color: admin.textMuted }}>
          Pick a building and a key, then copy either snippet into the partner's website.
        </p>
      </div>

      <AdminField label="Building">
        <Select value={selectedBuildingId} onValueChange={setSelectedBuildingId}>
          <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue placeholder="Select building" /></SelectTrigger>
          <SelectContent>
            {buildings.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminField>

      <div className="h-4" />

      {selectedBuildingId && <BuildingEmbedPanel key={selectedBuildingId} buildingId={selectedBuildingId} />}
    </div>
  );
};

export default AdminEmbed;
