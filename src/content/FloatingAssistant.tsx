import { useState, useRef, useCallback } from 'react';
import {
  Shield,
  Zap,
  Search,
  MessageSquare,
  User,
  X,
  GripVertical,
} from 'lucide-react';
import type { FillReport, PortalContext } from '@/types';

interface FloatingAssistantProps {
  onFillForm: () => Promise<FillReport | null>;
  onClearHighlights: () => void;
  portalContext: PortalContext;
}

const PORTAL_LABELS: Record<PortalContext, string> = {
  job: 'Job Portal',
  scholarship: 'Scholarship',
  hackathon: 'Hackathon',
  college: 'College Admission',
  government: 'Government Form',
  general: 'Web Form',
};

export function FloatingAssistant({
  onFillForm,
  onClearHighlights,
  portalContext,
}: FloatingAssistantProps) {
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<FillReport | null>(null);
  const [filling, setFilling] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 80 });
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  const handleFill = useCallback(async () => {
    setFilling(true);
    onClearHighlights();
    const result = await onFillForm();
    setReport(result);
    setFilling(false);
    setExpanded(true);
  }, [onFillForm, onClearHighlights]);

  const onDragStart = (e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: dragRef.current.posX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.posY + (ev.clientY - dragRef.current.startY),
      });
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="fv-assistant"
      style={{ bottom: `${position.y}px`, right: `${position.x}px` }}
    >
      {expanded && report && (
        <div className="fv-panel">
          <div className="fv-panel-header">
            <span className="fv-panel-title">Fill Report</span>
            <button className="fv-btn-icon" onClick={() => setExpanded(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="fv-panel-body">
            <div className="fv-stat">
              <span className="fv-stat-num">{report.totalFields}</span>
              <span className="fv-stat-label">Detected</span>
            </div>
            <div className="fv-stat fv-stat-success">
              <span className="fv-stat-num">{report.filledCount}</span>
              <span className="fv-stat-label">Filled</span>
            </div>
            <div className="fv-stat fv-stat-warning">
              <span className="fv-stat-num">{report.reviewCount}</span>
              <span className="fv-stat-label">Review</span>
            </div>
            <div className="fv-stat fv-stat-error">
              <span className="fv-stat-num">{report.unknownCount}</span>
              <span className="fv-stat-label">Unknown</span>
            </div>
          </div>
          <div className="fv-panel-footer">
            <button className="fv-btn-sm" onClick={onClearHighlights}>
              Clear Highlights
            </button>
          </div>
        </div>
      )}

      <div className="fv-fab-group">
        {expanded && (
          <div className="fv-actions">
            <button className="fv-action-btn" title="Search Vault">
              <Search size={16} />
            </button>
            <button className="fv-action-btn" title="Generate Answer">
              <MessageSquare size={16} />
            </button>
            <button className="fv-action-btn" title="Switch Profile">
              <User size={16} />
            </button>
          </div>
        )}

        <div className="fv-fab-container">
          <span
            className="fv-drag-handle"
            onMouseDown={onDragStart}
            title="Drag to move"
          >
            <GripVertical size={12} />
          </span>
          <button
            className="fv-fab"
            onClick={handleFill}
            disabled={filling}
            title="Fill Form"
          >
            {filling ? (
              <span className="fv-spinner" />
            ) : (
              <Zap size={20} />
            )}
          </button>
        </div>
      </div>

      <div className="fv-badge">
        <Shield size={10} />
        <span>{PORTAL_LABELS[portalContext]}</span>
      </div>
    </div>
  );
}
