import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileUp,
  FileText,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Upload,
  Workflow,
  Shield,
  Zap,
  BarChart3,
  Database,
} from 'lucide-react';
import { uploadPDF, fetchJSON } from '../api/client';

interface ExtractedDoc {
  upload_id: string;
  filename: string;
  pages: number;
  text: string;
  size_bytes: number;
}

interface Initiative {
  key: string;
  name: string;
  crime_type: string;
}

const CRIME_COLORS: Record<string, string> = {
  ML: 'from-purple-500/20 to-purple-900/10 border-purple-500/30 text-purple-300',
  HT: 'from-red-500/20 to-red-900/10 border-red-500/30 text-red-300',
  TF: 'from-amber-500/20 to-amber-900/10 border-amber-500/30 text-amber-300',
  Drugs: 'from-emerald-500/20 to-emerald-900/10 border-emerald-500/30 text-emerald-300',
  Tax: 'from-blue-500/20 to-blue-900/10 border-blue-500/30 text-blue-300',
  Fraud: 'from-orange-500/20 to-orange-900/10 border-orange-500/30 text-orange-300',
  Sanctions: 'from-rose-500/20 to-rose-900/10 border-rose-500/30 text-rose-300',
  Wildlife: 'from-green-500/20 to-green-900/10 border-green-500/30 text-green-300',
  CSAM: 'from-slate-500/20 to-slate-900/10 border-slate-500/30 text-slate-300',
};

export default function HomePage() {
  const navigate = useNavigate();
  const [extractedDoc, setExtractedDoc] = useState<ExtractedDoc | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loadingInitiatives, setLoadingInitiatives] = useState(false);
  const [fetchingInitiative, setFetchingInitiative] = useState<string | null>(null);

  // Load initiatives on first render
  useState(() => {
    setLoadingInitiatives(true);
    fetchJSON<{ initiatives: Initiative[] }>('/initiatives')
      .then(d => setInitiatives(d.initiatives))
      .catch(console.error)
      .finally(() => setLoadingInitiatives(false));
  });

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setExtractedDoc(null);

    try {
      const result = await uploadPDF(file);
      setExtractedDoc(result);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024,
  });

  const handleGoToPipeline = () => {
    if (extractedDoc) {
      navigate('/projects', { state: { regulatoryText: extractedDoc.text, source: extractedDoc.filename } });
    }
  };

  const handleSelectInitiative = async (key: string) => {
    setFetchingInitiative(key);
    try {
      const doc = await fetchJSON<{ full_text: string; name: string }>(`/initiatives/${key}`);
      navigate('/projects', { state: { regulatoryText: doc.full_text, source: doc.name } });
    } catch (e) {
      console.error(e);
    } finally {
      setFetchingInitiative(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            Signal-to-Action AML Platform
          </div>
          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
            Transform Regulatory Text into
            <span className="bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent"> Detection Code</span>
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Upload a FINTRAC operational alert or regulatory PDF. Our multi-agent pipeline will extract indicators
            and generate executable AML feature code.
          </p>
        </motion.div>

        {/* PDF Drop Zone */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-10"
        >
          <div
            {...getRootProps()}
            className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer
              transition-all duration-300 group
              ${isDragActive
                ? 'border-purple-400 bg-purple-500/10 scale-[1.01]'
                : 'border-slate-700 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-800/30'
              }
              ${isUploading ? 'pointer-events-none opacity-60' : ''}
            `}
          >
            <input {...getInputProps()} />

            {isUploading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-12 h-12 text-purple-400 animate-spin" />
                <p className="text-slate-300 text-lg">Extracting text from PDF...</p>
              </div>
            ) : isDragActive ? (
              <div className="flex flex-col items-center gap-3">
                <Upload className="w-12 h-12 text-purple-400 animate-bounce" />
                <p className="text-purple-300 text-lg font-medium">Drop your PDF here</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center
                  group-hover:from-purple-900/40 group-hover:to-indigo-900/40 transition-all duration-300">
                  <FileUp className="w-7 h-7 text-slate-400 group-hover:text-purple-400 transition-colors" />
                </div>
                <div>
                  <p className="text-slate-300 text-lg">
                    Drag & drop a <span className="text-purple-300 font-medium">regulatory PDF</span> here
                  </p>
                  <p className="text-slate-500 text-sm mt-1">or click to browse · PDF up to 50MB</p>
                </div>
              </div>
            )}
          </div>

          {/* Upload error */}
          {uploadError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 p-3 bg-red-900/20 border border-red-700/30 rounded-xl text-red-300 text-sm"
            >
              {uploadError}
            </motion.div>
          )}

          {/* Extracted doc result */}
          <AnimatePresence>
            {extractedDoc && (
              <motion.div
                initial={{ opacity: 0, y: 20, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-4 bg-slate-900/60 border border-slate-700/50 rounded-2xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">{extractedDoc.filename}</h3>
                      <p className="text-xs text-slate-400">
                        {extractedDoc.pages} pages · {(extractedDoc.size_bytes / 1024).toFixed(0)} KB · {extractedDoc.text.length.toLocaleString()} chars extracted
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleGoToPipeline}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white
                      text-sm font-medium rounded-xl transition-colors"
                  >
                    Compile Features
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Preview */}
                <div className="bg-slate-800/50 rounded-xl p-4 max-h-48 overflow-y-auto">
                  <p className="text-xs text-slate-400 font-mono leading-relaxed whitespace-pre-wrap">
                    {extractedDoc.text.slice(0, 2000)}
                    {extractedDoc.text.length > 2000 && (
                      <span className="text-slate-600">... ({(extractedDoc.text.length - 2000).toLocaleString()} more chars)</span>
                    )}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex-1 h-px bg-slate-800" />
          <span className="text-xs text-slate-500 uppercase tracking-wider">or select a FINTRAC initiative</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        {/* Initiative grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid grid-cols-3 gap-3 mb-12"
        >
          {loadingInitiatives
            ? Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-800/30 rounded-xl animate-pulse" />
              ))
            : initiatives.map((init, i) => (
                <motion.button
                  key={init.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i }}
                  onClick={() => handleSelectInitiative(init.key)}
                  disabled={fetchingInitiative !== null}
                  className={`text-left p-4 rounded-xl border bg-gradient-to-br transition-all duration-200
                    hover:scale-[1.02] hover:shadow-lg disabled:opacity-50 disabled:hover:scale-100
                    ${CRIME_COLORS[init.crime_type] || 'from-slate-500/20 to-slate-900/10 border-slate-500/30 text-slate-300'}
                    ${fetchingInitiative === init.key ? 'ring-2 ring-purple-500 animate-pulse' : ''}
                  `}
                >
                  <div className="flex items-start justify-between">
                    <FileText className="w-4 h-4 mt-0.5 opacity-60" />
                    <span className="text-[10px] opacity-60 uppercase tracking-wider">{init.crime_type}</span>
                  </div>
                  <div className="text-sm font-medium mt-2 leading-snug">{init.name}</div>
                </motion.button>
              ))}
        </motion.div>

        {/* Feature cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="grid grid-cols-3 gap-4 mb-10"
        >
          {[
            {
              icon: Workflow,
              title: 'Multi-Agent Pipeline',
              description: 'Perceive → Reason → Act with automatic self-correction and validation.',
              color: 'text-purple-400',
              bg: 'bg-purple-500/10',
            },
            {
              icon: Shield,
              title: '6-Stage Validation',
              description: 'AST analysis, security scanning, execution testing, and quality checks.',
              color: 'text-emerald-400',
              bg: 'bg-emerald-500/10',
            },
            {
              icon: Zap,
              title: 'Instant Execution',
              description: 'Run generated features on real transaction data with live statistics.',
              color: 'text-sky-400',
              bg: 'bg-sky-500/10',
            },
            {
              icon: FileText,
              title: 'PDF Extraction',
              description: 'Drag and drop regulatory PDFs for automatic text extraction.',
              color: 'text-amber-400',
              bg: 'bg-amber-500/10',
            },
            {
              icon: BarChart3,
              title: 'Feature Analytics',
              description: 'Histograms, percentiles, and distribution analysis for every feature.',
              color: 'text-indigo-400',
              bg: 'bg-indigo-500/10',
            },
            {
              icon: Database,
              title: '7 Transaction Channels',
              description: 'Card, EFT, EMT, Cheque, ABM, Wire, and Western Union data support.',
              color: 'text-rose-400',
              bg: 'bg-rose-500/10',
            },
          ].map(({ icon: Icon, title, description, color, bg }) => (
            <div
              key={title}
              className="p-5 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/60 transition-colors"
            >
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`w-4.5 h-4.5 ${color}`} />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
