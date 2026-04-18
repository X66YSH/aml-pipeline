import { motion } from 'framer-motion';
import { Settings, Cpu, Key, Database, Palette, Info, Check } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';

interface SettingItem {
  key: string;
  label: string;
  description: string;
  options: string[];
}

const MODEL_GROUP: SettingItem[] = [
  {
    key: 'model',
    label: 'LLM Model',
    description: 'Model used for feature code generation',
    options: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  },
  {
    key: 'temperature',
    label: 'Temperature',
    description: 'Sampling temperature — 0 = deterministic, higher = more creative',
    options: ['0', '0.1', '0.3', '0.5', '0.7', '1.0'],
  },
  {
    key: 'max_corrections',
    label: 'Max Self-Corrections',
    description: 'How many times the agent retries if AST validation fails',
    options: ['1', '3', '5', '10'],
  },
];

const EXECUTION_GROUP: SettingItem[] = [
  {
    key: 'timeout',
    label: 'Timeout (seconds)',
    description: 'Maximum execution time for feature code',
    options: ['30', '60', '120', '300'],
  },
  {
    key: 'sample_rows',
    label: 'Validation Sample Rows',
    description: 'Rows used when running the 6-stage validator',
    options: ['10000', '25000', '50000', '100000'],
  },
  {
    key: 'max_exec_rows',
    label: 'Max Execution Rows',
    description: 'Maximum rows processed during feature execution',
    options: ['50000', '100000', '250000', '500000'],
  },
];

export default function SettingsPage() {
  const { settings, setSettings } = useSettings();

  const handleChange = (key: string, value: string) => {
    setSettings({ [key]: value });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Settings className="w-6 h-6 text-slate-400" />
              Settings
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Changes are saved automatically and applied to all pipeline calls.
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/10 border border-emerald-600/20 rounded-lg">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs text-emerald-400">Auto-saved</span>
          </div>
        </div>

        {/* Model settings */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 }}
          className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden mb-6"
        >
          <div className="px-5 py-3.5 border-b border-slate-800/60 flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Model</h2>
          </div>
          <div className="divide-y divide-slate-800/40">
            {MODEL_GROUP.map(item => (
              <div key={item.key} className="px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-white">{item.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>
                </div>
                <select
                  value={settings[item.key as keyof typeof settings] as string}
                  onChange={e => handleChange(item.key, e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300
                    focus:outline-none focus:ring-1 focus:ring-purple-500/50 shrink-0"
                >
                  {item.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Execution settings */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden mb-6"
        >
          <div className="px-5 py-3.5 border-b border-slate-800/60 flex items-center gap-2.5">
            <Database className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Execution</h2>
          </div>
          <div className="divide-y divide-slate-800/40">
            {EXECUTION_GROUP.map(item => (
              <div key={item.key} className="px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-white">{item.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>
                </div>
                <select
                  value={settings[item.key as keyof typeof settings] as string}
                  onChange={e => handleChange(item.key, e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300
                    focus:outline-none focus:ring-1 focus:ring-purple-500/50 shrink-0"
                >
                  {item.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Appearance (placeholder — only dark now) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden mb-6"
        >
          <div className="px-5 py-3.5 border-b border-slate-800/60 flex items-center gap-2.5">
            <Palette className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Appearance</h2>
          </div>
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-white">Theme</div>
              <div className="text-xs text-slate-500 mt-0.5">Application color theme</div>
            </div>
            <span className="text-xs text-slate-500 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
              Dark (only)
            </span>
          </div>
        </motion.div>

        {/* About */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-5 mb-4"
        >
          <div className="flex items-center gap-2.5 mb-3">
            <Info className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">About</h2>
          </div>
          <div className="space-y-1.5 text-xs text-slate-400">
            <p><span className="text-slate-300">S2A Platform</span> — Signal-to-Action AML Detection</p>
            <p>Version 1.0.0 — Feature Engineering Pipeline</p>
            <p>Built with FastAPI · React · TypeScript · Tailwind CSS · GPT-4o · SQLite</p>
          </div>
        </motion.div>

        {/* API Keys notice */}
        <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-start gap-3">
          <Key className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-amber-300 font-medium">API Keys</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Configured via <code className="text-amber-400/80">.env</code> at the project root. Not stored in the app.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
