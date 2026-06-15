import { useState } from 'react';
import { ClipboardPaste, Sparkles, Check, CheckCircle2 } from 'lucide-react';
import { extractFieldsFromPastedText } from '@/lib/documents/text-extractor';
import * as Vault from '@/lib/vault/vault-service';
import type { ExtractedField } from '@/types';

interface PasteExtractSectionProps {
  profileId: string;
}

export function PasteExtractSection({ profileId }: PasteExtractSectionProps) {
  const [pastedText, setPastedText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [extractMethod, setExtractMethod] = useState<'ollama' | 'local' | null>(null);
  const [extractModel, setExtractModel] = useState('');

  const handleExtract = async () => {
    setExtracting(true);
    setError('');
    setStatus('Reading pasted text with local model...');
    setFields([]);
    setSavedCount(0);
    setExtractMethod(null);
    setExtractModel('');

    try {
      const result = await extractFieldsFromPastedText(pastedText);

      if (!result.ok) {
        setError(result.error ?? 'Could not extract fields');
        return;
      }

      const extractedFields = Array.isArray(result.fields) ? result.fields : [];
      if (extractedFields.length === 0) {
        setError('No fields could be extracted from the pasted text');
        return;
      }

      setFields(extractedFields);
      setExtractMethod(result.method);
      setExtractModel(result.model ?? '');

      if (result.method === 'ollama' && result.model) {
        setStatus(`Extracted ${extractedFields.length} fields using ${result.model}`);
      } else {
        setStatus(`Extracted ${extractedFields.length} fields using local parsing`);
      }

      if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
      setStatus('');
    }
  };

  const handleSaveAll = async () => {
    if (fields.length === 0) return;

    setExtracting(true);
    setError('');

    try {
      const { savedCount: count, savedFields } = await Vault.applyExtractedFieldsToVault(
        profileId,
        fields,
      );
      setFields(savedFields);
      setSavedCount(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save fields');
    } finally {
      setExtracting(false);
    }
  };

  const handleApproveField = async (field: ExtractedField) => {
    await Vault.upsertField(profileId, field.key, field.label, field.value, field.category);
    setFields((current) =>
      current.map((item) =>
        item.key === field.key && item.value === field.value
          ? { ...item, approved: true }
          : item,
      ),
    );
  };

  return (
    <div className="p-4 border-b border-slate-100 space-y-3 bg-slate-50/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ClipboardPaste className="w-4 h-4 text-brand-500" />
          <h2 className="text-sm font-semibold text-slate-700">Paste & Extract</h2>
        </div>
        <button
          onClick={() => void handleExtract()}
          disabled={extracting || !pastedText.trim()}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-600 bg-brand-50 rounded-md hover:bg-brand-100 disabled:opacity-60"
        >
          <Sparkles className="w-3 h-3" />
          {extracting ? 'Extracting...' : 'Extract fields'}
        </button>
      </div>

      <p className="text-[10px] text-slate-500">
        Paste resumes, ID details, research papers, articles, or any long text. Your local
        Ollama model extracts titles, authors, findings, skills, contact info, and other key fields.
      </p>

      <textarea
        value={pastedText}
        onChange={(e) => setPastedText(e.target.value)}
        placeholder={`Works with long paragraphs too — paste a paper, resume, or notes.\n\nExample (research paper): paste the full PDF text and extract title, authors, abstract, key findings, dataset, results, DOI...\n\nExample (profile):\nName: Rahul Sharma\nEmail: rahul@email.com\nSkills: Python, React`}
        rows={8}
        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-200 bg-white"
      />

      {status && (
        <p className="text-[10px] text-brand-600 bg-brand-50 px-2 py-1 rounded-md">{status}</p>
      )}

      {savedCount > 0 && (
        <div className="flex items-start gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-800">
            Saved {savedCount} field{savedCount === 1 ? '' : 's'} to vault
            {extractMethod === 'ollama' && extractModel ? ` via ${extractModel}` : ''}.
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 bg-red-50 px-2 py-1.5 rounded-md">{error}</p>
      )}

      {fields.length > 0 && (
        <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              {savedCount > 0 ? 'Saved fields' : `${fields.length} fields found`}
            </span>
            {savedCount === 0 && (
              <button
                onClick={() => void handleSaveAll()}
                disabled={extracting}
                className="text-[10px] text-brand-600 hover:underline disabled:opacity-60"
              >
                Save all to vault
              </button>
            )}
          </div>

          {fields.map((field, index) => (
            <div key={`${field.key}-${index}`} className="flex items-start gap-2 text-xs">
              <span className="text-slate-500 w-28 shrink-0">{field.label}:</span>
              <span className="flex-1 text-slate-700 break-words whitespace-pre-wrap">
                {field.value}
              </span>
              {field.approved ? (
                <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <button
                  onClick={() => void handleApproveField(field)}
                  className="text-[10px] text-brand-600 hover:underline shrink-0"
                >
                  Save
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
