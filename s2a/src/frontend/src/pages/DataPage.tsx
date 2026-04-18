import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  Table,
  Upload,
  FileSpreadsheet,
  ChevronRight,
  Rows3,
  Columns3,
  HardDrive,
  Eye,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { fetchJSON, uploadFile } from '../api/client';

type DatasetMode = 'fintrac' | 'ibm_aml';

interface Channel {
  key: string;
  name: string;
  columns: string[];
  row_count: number;
}

interface SampleData {
  table_name: string;
  columns: string[];
  dtypes: Record<string, string>;
  sample: Record<string, unknown>[];
}

interface IbmAmlSampleResponse {
  tables: {
    transactions: {
      columns: string[];
      dtypes: Record<string, string>;
      sample: Record<string, unknown>[];
    };
  };
}

export default function DataPage() {
  const [mode, setMode] = useState<DatasetMode>('fintrac');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [sampleData, setSampleData] = useState<SampleData | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<{ id: string; name: string; rows: number }[]>([]);

  useEffect(() => {
    if (mode === 'fintrac') {
      fetchJSON<{ channels: Channel[] }>('/channels')
        .then(d => setChannels(d.channels))
        .catch(console.error);
    }
  }, [mode]);

  // Reset selection when switching modes
  useEffect(() => {
    setSelectedChannel(null);
    setSampleData(null);
  }, [mode]);

  const handleSelectChannel = async (key: string) => {
    setSelectedChannel(key);
    setLoadingSample(true);
    try {
      if (mode === 'fintrac') {
        const d = await fetchJSON<{ info: SampleData }>(`/channels/${key}/sample`);
        setSampleData(d.info);
      } else {
        const d = await fetchJSON<IbmAmlSampleResponse>('/schemas/ibm_aml/sample');
        const txn = d.tables.transactions;
        setSampleData({
          table_name: 'IBM AML Transactions',
          columns: txn.columns,
          dtypes: txn.dtypes,
          sample: txn.sample,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSample(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    try {
      const result = await uploadFile(file);
      setUploadedFiles(prev => [...prev, {
        id: result.upload_id,
        name: result.filename,
        rows: result.total_rows,
      }]);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    maxFiles: 1,
  });

  // Stats based on mode
  const isFintrac = mode === 'fintrac';
  const totalRows = isFintrac
    ? channels.reduce((sum, c) => sum + c.row_count, 0)
    : 5_000_000;
  const totalCols = isFintrac
    ? new Set(channels.flatMap(c => c.columns)).size
    : 17;
  const channelCount = isFintrac ? channels.length : 1;

  // Items for channel list
  const channelItems = isFintrac
    ? channels.map(ch => ({
        key: ch.key,
        name: ch.name,
        rowCount: ch.row_count,
        colCount: ch.columns.length,
      }))
    : [{
        key: 'ibm_aml',
        name: 'IBM AML Transactions',
        rowCount: 5_000_000,
        colCount: 17,
      }];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Database className="w-6 h-6 text-sky-400" />
            Data Explorer
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse transaction channels, preview data, and upload custom datasets.
          </p>
        </div>

        {/* Dataset Switcher */}
        <div className="flex gap-1 p-1 bg-slate-800/60 rounded-lg mb-6">
          <button
            onClick={() => setMode('fintrac')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              mode === 'fintrac'
                ? 'bg-sky-500/20 text-sky-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            FINTRAC (7 Channels)
          </button>
          <button
            onClick={() => setMode('ibm_aml')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              mode === 'ibm_aml'
                ? 'bg-purple-500/20 text-purple-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            IBM AML (Merged)
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          {[
            { label: isFintrac ? 'Channels' : 'Tables', value: channelCount, icon: Table, color: 'text-sky-400' },
            { label: 'Total Rows', value: totalRows.toLocaleString(), icon: Rows3, color: 'text-emerald-400' },
            { label: isFintrac ? 'Unique Columns' : 'Columns', value: totalCols, icon: Columns3, color: 'text-purple-400' },
            { label: 'Uploaded Files', value: uploadedFiles.length, icon: HardDrive, color: 'text-amber-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4">
              <Icon className={`w-4 h-4 ${color} mb-2`} />
              <div className="text-2xl font-bold text-white">{value}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Channel list */}
          <div className="col-span-1 space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
              {isFintrac ? 'Transaction Channels' : 'Dataset'}
            </h2>
            {channelItems.map((ch, i) => (
              <motion.button
                key={ch.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => handleSelectChannel(ch.key)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all
                  ${selectedChannel === ch.key
                    ? isFintrac
                      ? 'bg-sky-500/10 border-sky-500/30 text-white'
                      : 'bg-purple-500/10 border-purple-500/30 text-white'
                    : 'bg-slate-900/40 border-slate-800/60 text-slate-300 hover:border-slate-700/60'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <FileSpreadsheet className={`w-4 h-4 ${
                      selectedChannel === ch.key
                        ? isFintrac ? 'text-sky-400' : 'text-purple-400'
                        : 'text-slate-500'
                    }`} />
                    <span className="text-sm font-medium">{ch.name}</span>
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 transition-colors ${
                    selectedChannel === ch.key
                      ? isFintrac ? 'text-sky-400' : 'text-purple-400'
                      : 'text-slate-600'
                  }`} />
                </div>
                <div className="flex items-center gap-3 mt-1.5 ml-[26px]">
                  <span className="text-[10px] text-slate-500">{ch.rowCount.toLocaleString()} rows</span>
                  <span className="text-[10px] text-slate-500">{ch.colCount} columns</span>
                </div>
              </motion.button>
            ))}

            {/* Upload zone */}
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Upload CSV</h2>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
                  ${isDragActive
                    ? 'border-sky-400 bg-sky-500/10'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-900/20'
                  }`}
              >
                <input {...getInputProps()} />
                <Upload className="w-6 h-6 text-slate-500 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Drop CSV here</p>
              </div>

              {uploadedFiles.map(f => (
                <div key={f.id} className="mt-2 p-3 bg-slate-900/40 border border-slate-800/60 rounded-xl text-xs text-slate-300">
                  {f.name} · {f.rows.toLocaleString()} rows
                </div>
              ))}
            </div>
          </div>

          {/* Data preview */}
          <div className="col-span-2">
            {selectedChannel && sampleData ? (
              <motion.div
                key={selectedChannel}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-slate-800/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className={`w-4 h-4 ${isFintrac ? 'text-sky-400' : 'text-purple-400'}`} />
                    <span className="text-sm font-semibold text-white">{sampleData.table_name}</span>
                    <span className="text-xs text-slate-500">{sampleData.columns.length} columns</span>
                  </div>
                </div>

                {/* Column types */}
                <div className="px-5 py-3 border-b border-slate-800/60 flex flex-wrap gap-1.5">
                  {sampleData.columns.map(col => (
                    <span key={col} className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-mono">
                      {col}: <span className={isFintrac ? 'text-sky-400' : 'text-purple-400'}>{sampleData.dtypes[col]}</span>
                    </span>
                  ))}
                </div>

                {/* Data table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="bg-slate-800/40">
                        {sampleData.columns.map(c => (
                          <th key={c} className="px-3 py-2 text-left text-slate-400 font-medium whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sampleData.sample.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-slate-800/30 hover:bg-slate-800/20">
                          {sampleData.columns.map(c => (
                            <td key={c} className="px-3 py-2 text-slate-300 whitespace-nowrap max-w-[200px] truncate">
                              {String(row[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            ) : loadingSample ? (
              <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-10 text-center">
                <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-slate-400">Loading data preview...</p>
              </div>
            ) : (
              <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-10 text-center">
                <Database className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500">
                  {isFintrac ? 'Select a channel to preview data' : 'Click the dataset to preview data'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
