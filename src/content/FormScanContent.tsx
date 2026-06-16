import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import {
  analyzeForm,
  clearHighlights,
  fillFormAsync,
  scanFormFields,
  toFormTargetFields,
  toPageFormFieldDescriptors,
} from '@/lib/autofill/form-scanner';
import { getLearnedMappingsForPage } from '@/lib/learning/field-learning';
import { fetchVaultContext, sendMessage } from './form-scan-api';
import type { ExtractedField, FillReport, FormFieldMatch, FormTargetField } from '@/types';

function fieldStatus(match: FormFieldMatch): 'ready' | 'review' | 'missing' {
  if (match.isLongAnswer) return 'review';
  if (match.suggestedValue && match.confidence >= 0.5) {
    return match.needsReview ? 'review' : 'ready';
  }
  return 'missing';
}

function fieldLabel(match: FormFieldMatch): string {
  return match.label || match.name || match.placeholder || 'Unlabeled field';
}

interface FormScanContentProps {
  /** Run scan on mount */
  autoScan?: boolean;
  /** Show upload/paste notification when fields are missing */
  showUploadNotice?: boolean;
  compact?: boolean;
  onReportChange?: (report: FillReport | null) => void;
}

export function FormScanContent({
  autoScan = true,
  showUploadNotice = true,
  compact = false,
  onReportChange,
}: FormScanContentProps) {
  const [report, setReport] = useState<FillReport | null>(null);
  const [loading, setLoading] = useState(autoScan);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([]);
  const [profileId, setProfileId] = useState('');
  const [formTargets, setFormTargets] = useState<FormTargetField[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const updateReport = useCallback(
    (next: FillReport | null) => {
      setReport(next);
      onReportChange?.(next);
    },
    [onReportChange],
  );

  const runScan = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');

    try {
      const context = await fetchVaultContext();
      if (!context) {
        setError('Could not load vault data. Reload the extension and try again.');
        updateReport(null);
        return;
      }

      setProfileId(context.profileId);
      const mappings = await getLearnedMappingsForPage(window.location.href);
      const scanned = scanFormFields(context.vaultData, mappings);
      const syncResult = await sendMessage<{
        createdCount: number;
        createdLabels: string[];
        vaultData: Record<string, string>;
      }>({
        type: 'SYNC_PAGE_FORM_FIELDS',
        payload: {
          profileId: context.profileId,
          url: window.location.href,
          fields: toPageFormFieldDescriptors(scanned),
        },
      });

      const freshMappings = await getLearnedMappingsForPage(window.location.href);
      const result = analyzeForm(syncResult.vaultData, freshMappings);
      setFormTargets(toFormTargetFields(result.matches, freshMappings));
      updateReport(result);

      const notices: string[] = [];
      if (syncResult.createdCount > 0) {
        const preview = syncResult.createdLabels.slice(0, 4).join(', ');
        const extra =
          syncResult.createdLabels.length > 4
            ? ` +${syncResult.createdLabels.length - 4} more`
            : '';
        notices.push(
          `Added ${syncResult.createdCount} custom field${syncResult.createdCount === 1 ? '' : 's'} to your vault (${preview}${extra}).`,
        );
      }

      if (showUploadNotice && result.unknownCount > 0) {
        notices.push(
          `${result.unknownCount} field${result.unknownCount === 1 ? '' : 's'} still need values — upload a PNG/PDF or paste text. Ollama will extract and fill automatically.`,
        );
      } else if (result.unknownCount === 0 && result.totalFields > 0) {
        notices.push('All fields have vault data. Click “Fill form” to autofill.');
      }

      setNotice(notices.join(' '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not scan this page');
      updateReport(null);
    } finally {
      setLoading(false);
    }
  }, [showUploadNotice, updateReport]);

  useEffect(() => {
    if (autoScan) void runScan();
  }, [autoScan, runScan]);

  const saveAndFillFields = useCallback(
    async (fields: ExtractedField[]) => {
      if (!profileId || fields.length === 0) return;

      setSaving(true);
      setError('');

      try {
        await sendMessage({
          type: 'APPLY_EXTRACTED_TO_VAULT',
          payload: { profileId, fields },
        });

        const context = await fetchVaultContext();
        if (!context) {
          setError('Could not refresh vault after saving.');
          return;
        }

        const mappings = await getLearnedMappingsForPage(window.location.href);
        const scanned = scanFormFields(context.vaultData, mappings);
        const syncResult = await sendMessage<{ vaultData: Record<string, string> }>({
          type: 'SYNC_PAGE_FORM_FIELDS',
          payload: {
            profileId: context.profileId,
            url: window.location.href,
            fields: toPageFormFieldDescriptors(scanned),
          },
        });

        clearHighlights();
        const freshMappings = await getLearnedMappingsForPage(window.location.href);
        const fillReport = await fillFormAsync(syncResult.vaultData, freshMappings);
        setFormTargets(toFormTargetFields(fillReport.matches, freshMappings));
        updateReport(fillReport);
        setExtractedFields([]);
        setPastedText('');
        setNotice(
          `Ollama extracted ${fields.length} fields and filled ${fillReport.filledCount} of ${fillReport.totalFields} form fields.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save and fill');
      } finally {
        setSaving(false);
      }
    },
    [profileId, updateReport],
  );

  const runOllamaExtract = useCallback(
    async (text: string, sourceLabel = 'text') => {
      const { extractFieldsFromPastedText } = await import('@/lib/documents/text-extractor');
      const result = await extractFieldsFromPastedText(text, { formTargets });
      if (!result.ok || result.fields.length === 0) {
        throw new Error(result.error ?? `No fields could be extracted from the ${sourceLabel}`);
      }

      setExtractedFields(result.fields);
      const modelNote = result.model ? ` (${result.model})` : '';
      setNotice(`Ollama${modelNote} extracted ${result.fields.length} fields — saving and filling…`);
      await saveAndFillFields(result.fields);
      if (result.error) setError(result.error);
    },
    [formTargets, saveAndFillFields],
  );

  const handleExtractFromPaste = async () => {
    if (!pastedText.trim()) return;
    setExtracting(true);
    setError('');

    try {
      await runOllamaExtract(pastedText, 'pasted text');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractFromFile = async (file: File) => {
    setExtracting(true);
    setError('');
    setExtractedFields([]);

    try {
      if (
        file.type.startsWith('text/')
        || file.name.endsWith('.txt')
        || file.name.endsWith('.md')
      ) {
        const text = await file.text();
        await runOllamaExtract(text, file.name);
        return;
      }

      const { processUploadedDocument } = await import('@/lib/documents/document-parser');
      const parsed = await processUploadedDocument(file);
      const text = parsed.extractedText.trim();
      if (!text) {
        setError('Could not read this file. Try a clearer PNG/photo or paste the text.');
        return;
      }

      await runOllamaExtract(text, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process the file');
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSaveAndFill = async () => {
    await saveAndFillFields(extractedFields);
  };

  const handleFillForm = async () => {
    setSaving(true);
    setError('');

    try {
      const context = await fetchVaultContext();
      if (!context) {
        setError('Could not load vault data.');
        return;
      }

      clearHighlights();
      const mappings = await getLearnedMappingsForPage(window.location.href);
      const fillReport = await fillFormAsync(context.vaultData, mappings);
      updateReport(fillReport);
      setNotice(`Filled ${fillReport.filledCount} of ${fillReport.totalFields} fields.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fill failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fv-scan-loading">
        <span className="fv-spinner" />
        Scanning all form fields…
      </div>
    );
  }

  const allFields = report?.matches ?? [];
  const fieldLimit = compact ? 8 : 20;

  return (
    <>
      {showUploadNotice && notice && (
        <div className="fv-notice" role="status">
          <Upload size={14} className="fv-notice-icon" />
          <span>{notice}</span>
        </div>
      )}

      {report && (
        <div className="fv-scan-stats">
          <div className="fv-stat">
            <span className="fv-stat-num">{report.totalFields}</span>
            <span className="fv-stat-label">Detected</span>
          </div>
          <div className="fv-stat fv-stat-success">
            <span className="fv-stat-num">{report.filledCount}</span>
            <span className="fv-stat-label">Ready</span>
          </div>
          <div className="fv-stat fv-stat-warning">
            <span className="fv-stat-num">{report.reviewCount}</span>
            <span className="fv-stat-label">Review</span>
          </div>
          <div className="fv-stat fv-stat-error">
            <span className="fv-stat-num">{report.unknownCount}</span>
            <span className="fv-stat-label">Missing</span>
          </div>
        </div>
      )}

      {allFields.length > 0 && (
        <div className="fv-scan-section">
          <h3 className="fv-scan-section-title">Form fields on this page</h3>
          <ul className="fv-scan-field-rows">
            {allFields.slice(0, fieldLimit).map((match, index) => {
              const status = fieldStatus(match);
              return (
                <li key={`${match.name}-${index}`} className={`fv-field-row fv-field-${status}`}>
                  <span className="fv-field-name">{fieldLabel(match)}</span>
                  <span className="fv-field-badge">
                    {status === 'ready' ? 'Ready' : status === 'review' ? 'Review' : 'Missing'}
                  </span>
                </li>
              );
            })}
            {allFields.length > fieldLimit && (
              <li className="fv-scan-more">+{allFields.length - fieldLimit} more fields</li>
            )}
          </ul>
        </div>
      )}

      {showUploadNotice && report && report.unknownCount > 0 && (
        <div className="fv-scan-section fv-upload-block">
          <h3 className="fv-scan-section-title">
            <FileText size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            Extract answers from document or text
          </h3>
          <textarea
            className="fv-scan-textarea"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste resume, cover letter, or profile text here…"
            rows={compact ? 3 : 4}
          />
          <div className="fv-scan-actions-row">
            <button
              type="button"
              className="fv-btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={extracting}
            >
              Upload PNG / PDF
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
              className="fv-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleExtractFromFile(file);
              }}
            />
            <button
              type="button"
              className="fv-btn-secondary"
              onClick={() => void handleExtractFromPaste()}
              disabled={extracting || !pastedText.trim()}
            >
              {extracting || saving ? 'Extracting with Ollama…' : 'Extract & fill'}
            </button>
          </div>
        </div>
      )}

      {extractedFields.length > 0 && (
        <div className="fv-scan-section">
          <h3 className="fv-scan-section-title">{extractedFields.length} fields extracted</h3>
          <ul className="fv-scan-extracted-list">
            {extractedFields.slice(0, 6).map((field, index) => (
              <li key={`${field.key}-${index}`}>
                <strong>{field.label}:</strong> {field.value.slice(0, 60)}
                {field.value.length > 60 ? '…' : ''}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="fv-btn-primary fv-btn-block"
            onClick={() => void handleSaveAndFill()}
            disabled={saving}
          >
            {saving ? 'Saving & filling…' : 'Save to vault & fill form'}
          </button>
        </div>
      )}

      {error && <p className="fv-scan-error">{error}</p>}

      <div className="fv-scan-footer fv-scan-footer-compact">
        <button type="button" className="fv-btn-ghost" onClick={() => void runScan()}>
          Rescan
        </button>
        <button
          type="button"
          className="fv-btn-primary"
          onClick={() => void handleFillForm()}
          disabled={saving || !report}
        >
          {saving ? 'Filling…' : 'Fill form'}
        </button>
      </div>
    </>
  );
}
