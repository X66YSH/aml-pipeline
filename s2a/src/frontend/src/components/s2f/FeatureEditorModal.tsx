import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Code2 } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import { createFeature, updateFeature } from '../../api/client';
import type { FeatureRecord } from '../../api/client';

interface FeatureEditorModalProps {
  projectId: string;
  feature?: FeatureRecord | null; // null/undefined = create mode
  onSave: (saved: FeatureRecord) => void;
  onClose: () => void;
}

export default function FeatureEditorModal({ projectId, feature, onSave, onClose }: FeatureEditorModalProps) {
  const isEdit = !!feature;
  const [name, setName] = useState(feature?.name ?? '');
  const [description, setDescription] = useState(feature?.description ?? '');
  const [code, setCode] = useState(feature?.code ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLElement>(null);

  const highlighted = Prism.languages.python
    ? Prism.highlight(code || ' ', Prism.languages.python, 'python')
    : code;

  const handleTabKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      setCode(val.substring(0, start) + '  ' + val.substring(end));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, []);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedCode = code.trim();
    if (!trimmedName) { setError('Name is required'); return; }
    if (!trimmedCode) { setError('Code is required'); return; }

    setSaving(true);
    setError(null);
    try {
      let saved: FeatureRecord;
      if (isEdit) {
        const codeChanged = trimmedCode !== feature!.code;
        saved = await updateFeature(feature!.id, {
          name: trimmedName,
          description: description.trim(),
          code: trimmedCode,
          ...(codeChanged ? { status: 'draft' } : {}),
        });
      } else {
        saved = await createFeature({
          project_id: projectId,
          name: trimmedName,
          code: trimmedCode,
          description: description.trim(),
          status: 'draft',
        });
      }
      onSave(saved);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-white">
              {isEdit ? 'Edit Feature' : 'New Feature'}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. High Value Transaction Detector"
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white
                         placeholder:text-slate-600 focus:outline-none focus:border-purple-500/50 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the feature"
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white
                         placeholder:text-slate-600 focus:outline-none focus:border-purple-500/50 transition-colors"
            />
          </div>

          {/* Code — highlighted editor */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Python Code *</label>
            <div className="relative rounded-lg border border-slate-700 bg-[var(--color-bg-code)] overflow-hidden focus-within:border-purple-500/50 transition-colors">
              <pre
                className="absolute inset-0 px-3 py-2 text-xs font-mono leading-relaxed overflow-auto pointer-events-none !bg-transparent !m-0"
                aria-hidden="true"
              >
                <code
                  ref={highlightRef}
                  className="language-python"
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              </pre>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={handleTabKey}
                onScroll={(e) => {
                  const pre = e.currentTarget.previousElementSibling as HTMLElement;
                  if (pre) { pre.scrollTop = e.currentTarget.scrollTop; pre.scrollLeft = e.currentTarget.scrollLeft; }
                }}
                rows={20}
                spellCheck={false}
                placeholder={'def compute(df: pd.DataFrame) -> pd.Series:\n    """Your feature logic here."""\n    ...'}
                className="relative w-full px-3 py-2 text-xs font-mono leading-relaxed resize-y
                           bg-transparent text-transparent caret-slate-200 placeholder:text-slate-700
                           focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700 flex items-center justify-between">
          <div className="text-xs text-red-400 min-h-[1rem]">{error ?? ''}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white
                         hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium
                         bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50
                         disabled:cursor-not-allowed transition-colors"
            >
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
