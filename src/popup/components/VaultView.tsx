import { useState, useEffect, useCallback } from 'react';
import { Save, Plus } from 'lucide-react';
import { getFieldsByProfile, saveField } from '@/lib/storage/indexed-db';
import { upsertField } from '@/lib/vault/vault-service';
import type { VaultField } from '@/types';

interface VaultViewProps {
  profileId: string;
}

export function VaultView({ profileId }: VaultViewProps) {
  const [fields, setFields] = useState<VaultField[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customValue, setCustomValue] = useState('');

  const loadFields = useCallback(async () => {
    const data = await getFieldsByProfile(profileId);
    setFields(data);
    const values: Record<string, string> = {};
    for (const f of data) values[f.id] = f.value;
    setEditValues(values);
  }, [profileId]);

  useEffect(() => {
    void loadFields();
  }, [loadFields]);

  const handleSave = async (field: VaultField) => {
    setSaving(field.id);
    const updated = { ...field, value: editValues[field.id] ?? '', updatedAt: Date.now() };
    await saveField(updated);
    setSaving(null);
    await loadFields();
  };

  const handleAddCustom = async () => {
    if (!customLabel.trim()) return;
    const key = customLabel.toLowerCase().replace(/\s+/g, '_');
    await upsertField(profileId, key, customLabel.trim(), customValue, 'custom');
    setCustomLabel('');
    setCustomValue('');
    setAddingCustom(false);
    await loadFields();
  };

  const filledCount = fields.filter((f) => f.value).length;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Personal Vault</h2>
          <p className="text-[10px] text-slate-400">
            {filledCount}/{fields.length} fields filled
          </p>
        </div>
        <button
          onClick={() => setAddingCustom(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-600 bg-brand-50 rounded-md hover:bg-brand-100"
        >
          <Plus className="w-3 h-3" />
          Custom
        </button>
      </div>

      {addingCustom && (
        <div className="p-3 bg-slate-50 rounded-lg space-y-2">
          <input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Field label"
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
          />
          <input
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder="Value"
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
          />
          <button
            onClick={handleAddCustom}
            className="w-full py-1.5 text-xs font-medium text-white bg-brand-600 rounded-md"
          >
            Add Field
          </button>
        </div>
      )}

      <div className="space-y-2 max-h-[360px] overflow-y-auto">
        {fields.length === 0 ? (
          <div className="text-center py-6 text-slate-400">
            <p className="text-xs">No vault fields yet.</p>
            <p className="text-[10px] mt-1">Unlock again or reload the extension if this persists.</p>
          </div>
        ) : (
          fields.map((field) => (
          <div key={field.id} className="group">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
              {field.label}
            </label>
            <div className="flex gap-1.5 mt-0.5">
              <input
                value={editValues[field.id] ?? ''}
                onChange={(e) =>
                  setEditValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                }
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
                placeholder={`Enter ${field.label.toLowerCase()}`}
              />
              <button
                onClick={() => handleSave(field)}
                disabled={saving === field.id}
                className="px-2 py-1.5 text-brand-600 hover:bg-brand-50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Save className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))
        )}
      </div>

      {fields.length > 0 && filledCount === 0 && (
        <p className="text-[10px] text-slate-400 text-center pt-1">
          Fields are empty until you add your info, upload documents in Docs, or approve extracted data.
        </p>
      )}
    </div>
  );
}
