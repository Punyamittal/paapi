import { useState } from 'react';
import { Plus, Check, Star } from 'lucide-react';
import { createProfile, setDefaultProfile } from '@/lib/vault/vault-service';
import type { Profile } from '@/types';

interface ProfilesViewProps {
  profiles: Profile[];
  activeProfileId?: string;
  onRefresh: () => Promise<void>;
  onSwitch: (id: string) => void;
}

export function ProfilesView({
  profiles,
  activeProfileId,
  onRefresh,
  onSwitch,
}: ProfilesViewProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) {
      setError('Enter a profile name');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const profile = await createProfile(newName.trim());
      setNewName('');
      setCreating(false);
      await onRefresh();
      onSwitch(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultProfile(id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update default profile');
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Profiles</h2>
        <button
          onClick={() => {
            setCreating(true);
            setError('');
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-600 bg-brand-50 rounded-md hover:bg-brand-100"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      {creating && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Profile name"
              className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
              autoFocus
              disabled={saving}
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            />
            <button
              onClick={() => void handleCreate()}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-brand-600 rounded-md disabled:opacity-60"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}

      {!creating && error && <p className="text-xs text-red-500">{error}</p>}

      <div className="space-y-2">
        {profiles.length === 0 && !creating ? (
          <div className="text-center py-6 text-slate-400">
            <p className="text-xs">No profiles yet.</p>
            <p className="text-[10px] mt-1">Click New to create your first profile.</p>
          </div>
        ) : (
          profiles.map((profile) => (
            <div
              key={profile.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                activeProfileId === profile.id
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-slate-100 hover:bg-slate-50'
              }`}
              onClick={() => onSwitch(profile.id)}
            >
              <div
                className="w-4 h-4 rounded-full shrink-0"
                style={{ backgroundColor: profile.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-700 truncate">
                    {profile.name}
                  </span>
                  {profile.isDefault && (
                    <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                  )}
                </div>
                {profile.description && (
                  <p className="text-[10px] text-slate-400 truncate">
                    {profile.description}
                  </p>
                )}
              </div>
              {activeProfileId === profile.id && (
                <Check className="w-4 h-4 text-brand-600 shrink-0" />
              )}
              {!profile.isDefault && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSetDefault(profile.id);
                  }}
                  className="text-[10px] text-slate-400 hover:text-brand-600 shrink-0"
                >
                  Set default
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
