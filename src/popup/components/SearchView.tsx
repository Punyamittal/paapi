import { useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { sendExtensionMessageSafe } from '@/lib/messaging/extension-messages';
import type { SearchResult } from '@/types';

interface SearchViewProps {
  profileId: string;
}

export function SearchView({ profileId }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);

    const data = await sendExtensionMessageSafe<SearchResult[]>({
      type: 'SEARCH_VAULT',
      payload: { query: query.trim(), profileId },
    });

    setResults(Array.isArray(data) ? data : []);
    setSearching(false);
  };

  const typeLabels: Record<SearchResult['type'], string> = {
    field: 'Vault Field',
    document: 'Document',
    answer: 'Saved Answer',
    profile: 'Profile',
  };

  const typeColors: Record<SearchResult['type'], string> = {
    field: 'bg-emerald-50 text-emerald-600',
    document: 'bg-blue-50 text-blue-600',
    answer: 'bg-purple-50 text-purple-600',
    profile: 'bg-amber-50 text-amber-600',
  };

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Search Vault</h2>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search phone, resume, hackathon..."
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button
          onClick={handleSearch}
          disabled={searching}
          className="px-3 py-2 text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-60"
        >
          <SearchIcon className="w-4 h-4" />
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-2 max-h-[380px] overflow-y-auto">
          {results.map((result) => (
            <div
              key={result.id}
              className="p-2.5 border border-slate-100 rounded-lg hover:bg-slate-50"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`px-1.5 py-0.5 text-[10px] rounded ${typeColors[result.type]}`}
                >
                  {typeLabels[result.type]}
                </span>
                <span className="text-[10px] text-slate-400">
                  {Math.round(result.score * 100)}% match
                </span>
              </div>
              <p className="text-sm font-medium text-slate-700">{result.title}</p>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{result.snippet}</p>
            </div>
          ))}
        </div>
      )}

      {query && results.length === 0 && !searching && (
        <p className="text-xs text-slate-400 text-center py-4">No results found</p>
      )}
    </div>
  );
}
