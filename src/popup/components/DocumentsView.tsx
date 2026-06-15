import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Upload, FileText, Check, X, CheckCircle2 } from 'lucide-react';
import {
  getDocumentsByProfile,
  saveDocument,
  saveDocumentBlob,
  deleteDocument,
} from '@/lib/storage/indexed-db';
import { setOcrProgressHandler, warmUpOcr } from '@/lib/documents/ocr-service';
import { sendExtensionMessageSafe } from '@/lib/messaging/extension-messages';
import * as Vault from '@/lib/vault/vault-service';
import type { StoredDocument, ExtractedField } from '@/types';

const PasteExtractSection = lazy(() =>
  import('@/popup/components/PasteExtractSection').then((module) => ({
    default: module.PasteExtractSection,
  })),
);

interface DocumentsViewProps {
  profileId: string;
}

interface UploadSummary {
  fileName: string;
  savedCount: number;
  extractedCount: number;
  scanMethod?: 'ollama' | 'tesseract';
  scanModel?: string;
  scanFallbackReason?: string;
}

export function DocumentsView({ profileId }: DocumentsViewProps) {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [reviewDoc, setReviewDoc] = useState<StoredDocument | null>(null);
  const [lastUpload, setLastUpload] = useState<UploadSummary | null>(null);
  const [error, setError] = useState('');
  const [ocrReady, setOcrReady] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const ocrWarmupRef = useRef<Promise<void>>(warmUpOcr());

  const normalizeDocument = (doc: StoredDocument): StoredDocument => ({
    ...doc,
    extractedFields: Array.isArray(doc.extractedFields) ? doc.extractedFields : [],
  });

  const loadDocuments = useCallback(async () => {
    const docs = await getDocumentsByProfile(profileId);
    setDocuments(Array.isArray(docs) ? docs.map(normalizeDocument) : []);
  }, [profileId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    void sendExtensionMessageSafe({ type: 'CHECK_OLLAMA' });
  }, []);

  useEffect(() => {
    setOcrProgressHandler((message, progress) => {
      if (progress !== undefined) {
        setUploadStatus(`${message}... ${progress}%`);
      } else {
        setUploadStatus(`${message}...`);
      }
    });

    void ocrWarmupRef.current
      .then(() => {
        setOcrReady(true);
        setOcrLoading(false);
      })
      .catch(() => {
        setOcrReady(false);
        setOcrLoading(false);
      });

    return () => {
      setOcrProgressHandler(null);
    };
  }, []);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;

    setUploading(true);
    setError('');
    setLastUpload(null);

    try {
      for (const file of Array.from(files)) {
        const isImage =
          file.type.startsWith('image/') ||
          /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);

        if (isImage) {
          setUploadStatus('Loading OCR engine...');
          await ocrWarmupRef.current.catch(() => warmUpOcr());
        }

        setUploadStatus(`Scanning ${file.name}...`);

        const { processUploadedDocument, createDocumentRecord } = await import(
          '@/lib/documents/document-parser'
        );
        const processed = await processUploadedDocument(file);
        let record = createDocumentRecord(processed, profileId);

        if (processed.scanMethod === 'ollama') {
          setUploadStatus(`Read ${file.name} with ${processed.scanModel ?? 'Ollama vision'}...`);
        }

        if (processed.ocrError) {
          setError(
            processed.scanMethod === 'tesseract' && processed.scanFallbackReason
              ? `Used Tesseract fallback: ${processed.scanFallbackReason}`
              : `Scan failed for ${file.name}: ${processed.ocrError}`,
          );
        } else if (processed.extractedFields.length > 0) {
          setUploadStatus(`Saving ${processed.extractedFields.length} fields from ${file.name}...`);
          const { savedCount, savedFields } = await Vault.applyExtractedFieldsToVault(
            profileId,
            processed.extractedFields,
          );

          record = {
            ...record,
            extractedFields: savedFields,
            updatedAt: Date.now(),
          };

          setLastUpload({
            fileName: file.name,
            savedCount,
            extractedCount: processed.extractedFields.length,
            scanMethod: processed.scanMethod,
            scanModel: processed.scanModel,
            scanFallbackReason: processed.scanFallbackReason,
          });
          setReviewDoc(record);
        } else if (processed.extractedText.trim()) {
          setReviewDoc(record);
          setLastUpload({
            fileName: file.name,
            savedCount: 0,
            extractedCount: 0,
          });
          setError(
            `Text was read from ${file.name}, but no standard fields were detected. Open View to inspect the raw scan.`,
          );
        } else if (isImage) {
          setError(
            `No readable text found in ${file.name}. Use a straight, well-lit photo or screenshot with the full card visible and text in focus.`,
          );
        } else {
          setError(`Could not read text from ${file.name}. Try a clearer PDF or document.`);
        }

        await saveDocument(record);
        await saveDocumentBlob(record.id, processed.blob);
      }

      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process document');
    } finally {
      setUploading(false);
      setUploadStatus('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleApproveField = async (field: ExtractedField) => {
    if (!reviewDoc) return;
    await Vault.upsertField(profileId, field.key, field.label, field.value, field.category);

    const updatedFields = reviewDoc.extractedFields.map((f) =>
      f.key === field.key && f.value === field.value
        ? { ...f, approved: true }
        : f,
    );

    const updated = { ...reviewDoc, extractedFields: updatedFields, updatedAt: Date.now() };
    await saveDocument(updated);
    setReviewDoc(updated);
  };

  const handleDelete = async (id: string) => {
    await deleteDocument(id);
    if (reviewDoc?.id === id) setReviewDoc(null);
    await loadDocuments();
  };

  return (
    <div className="flex flex-col">
      <Suspense
        fallback={
          <div className="p-4 border-b border-slate-100 bg-slate-50/60">
            <p className="text-[10px] text-slate-500">Loading Paste & Extract...</p>
          </div>
        }
      >
        <PasteExtractSection profileId={profileId} />
      </Suspense>

      <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Documents</h2>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || ocrLoading}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-600 bg-brand-50 rounded-md hover:bg-brand-100 disabled:opacity-60"
        >
          <Upload className="w-3 h-3" />
          {uploading ? 'Scanning...' : ocrLoading ? 'Loading OCR...' : 'Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(e) => void handleUpload(e.target.files)}
        />
      </div>

      {uploadStatus && (
        <p className="text-[10px] text-brand-600 bg-brand-50 px-2 py-1.5 rounded-md">
          {uploadStatus}
        </p>
      )}

      {!uploading && ocrLoading && (
        <p className="text-[10px] text-brand-600 bg-brand-50 px-2 py-1 rounded-md">
          Preparing OCR engine... wait a moment before uploading images.
        </p>
      )}

      {!uploading && ocrReady && (
        <p className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
          Ready — uses Ollama vision when configured, otherwise Tesseract OCR.
        </p>
      )}

      {lastUpload && lastUpload.savedCount > 0 && (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-emerald-800">
              Saved {lastUpload.savedCount} field{lastUpload.savedCount === 1 ? '' : 's'} to vault
            </p>
            <p className="text-[10px] text-emerald-700 mt-0.5">
              From {lastUpload.fileName}
              {lastUpload.scanMethod === 'ollama' && lastUpload.scanModel
                ? ` via ${lastUpload.scanModel}`
                : lastUpload.scanMethod === 'tesseract'
                  ? ' via Tesseract OCR'
                  : ''}
              . Check the Vault tab to review or edit.
            </p>
            {lastUpload.scanMethod === 'tesseract' && lastUpload.scanFallbackReason && (
              <p className="text-[10px] text-amber-700 mt-1">
                Ollama was skipped: {lastUpload.scanFallbackReason}
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 bg-red-50 px-2 py-1.5 rounded-md">{error}</p>
      )}

      {reviewDoc && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              {reviewDoc.extractedFields.length > 0
                ? `Extracted from ${reviewDoc.name}`
                : `Scan result for ${reviewDoc.name}`}
            </span>
            <button onClick={() => setReviewDoc(null)}>
              <X className="w-3 h-3 text-slate-400" />
            </button>
          </div>
          {reviewDoc.extractedFields.map((field, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 w-24 shrink-0">{field.label}:</span>
              <span className="flex-1 truncate text-slate-700">{field.value}</span>
              {field.approved ? (
                <Check className="w-3 h-3 text-emerald-500 shrink-0" />
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
          {reviewDoc.extractedFields.length === 0 && reviewDoc.extractedText.trim() && (
            <pre className="text-[10px] text-slate-600 whitespace-pre-wrap max-h-32 overflow-y-auto bg-white border border-slate-100 rounded p-2">
              {reviewDoc.extractedText.trim()}
            </pre>
          )}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No documents uploaded yet</p>
          <p className="text-[10px] mt-1">
            Upload a resume, Aadhaar, PAN, or ID — fields are scanned and saved automatically
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[360px] overflow-y-auto">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 p-2.5 border border-slate-100 rounded-lg hover:bg-slate-50"
            >
              <FileText className="w-5 h-5 text-brand-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{doc.name}</p>
                <p className="text-[10px] text-slate-400">
                  {doc.type} · {(doc.size / 1024).toFixed(0)} KB
                  {doc.extractedFields.length > 0 &&
                    ` · ${doc.extractedFields.length} fields saved`}
                </p>
              </div>
              <button
                onClick={() => setReviewDoc(doc)}
                className="text-[10px] text-brand-600 hover:underline shrink-0"
              >
                View
              </button>
              <button
                onClick={() => void handleDelete(doc.id)}
                className="text-slate-300 hover:text-red-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
