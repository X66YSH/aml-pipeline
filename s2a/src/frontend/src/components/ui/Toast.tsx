import {
  createContext, useContext, useState, useCallback, useRef, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Info, X, Loader2 } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'loading';

export interface ToastOptions {
  type?: ToastType;
  title: string;
  description?: string;
  /** ms before auto-dismiss; 0 / loading = sticky until dismissed */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, 'description' | 'duration'>> {
  id: string;
  description?: string;
  duration: number;
}

interface ToastApi {
  toast: (opts: ToastOptions) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  loading: (title: string, description?: string) => string;
  /** update an existing toast (e.g. loading → success) */
  update: (id: string, opts: ToastOptions) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const ACCENT: Record<ToastType, { icon: typeof Info; color: string; bar: string }> = {
  success: { icon: CheckCircle2, color: 'text-emerald-300', bar: 'from-emerald-400 to-teal-400' },
  error: { icon: AlertTriangle, color: 'text-red-300', bar: 'from-red-400 to-rose-400' },
  info: { icon: Info, color: 'text-sky-300', bar: 'from-sky-400 to-cyan-400' },
  loading: { icon: Loader2, color: 'text-purple-300', bar: 'from-purple-400 to-indigo-400' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) { clearTimeout(tm); timers.current.delete(id); }
  }, []);

  const schedule = useCallback((id: string, duration: number) => {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    }
  }, [dismiss]);

  const toast = useCallback((opts: ToastOptions) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const type = opts.type ?? 'info';
    const duration = opts.duration ?? (type === 'loading' ? 0 : type === 'error' ? 6000 : 4000);
    setToasts((prev) => [...prev, { id, type, title: opts.title, description: opts.description, duration }]);
    schedule(id, duration);
    return id;
  }, [schedule]);

  const update = useCallback((id: string, opts: ToastOptions) => {
    const type = opts.type ?? 'info';
    const duration = opts.duration ?? (type === 'loading' ? 0 : type === 'error' ? 6000 : 4000);
    setToasts((prev) => prev.map((t) =>
      t.id === id ? { ...t, type, title: opts.title, description: opts.description, duration } : t));
    schedule(id, duration);
  }, [schedule]);

  const success = useCallback((title: string, description?: string) => toast({ type: 'success', title, description }), [toast]);
  const error = useCallback((title: string, description?: string) => toast({ type: 'error', title, description }), [toast]);
  const info = useCallback((title: string, description?: string) => toast({ type: 'info', title, description }), [toast]);
  const loading = useCallback((title: string, description?: string) => toast({ type: 'loading', title, description }), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, loading, update, dismiss }}>
      {children}
      {createPortal(
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 w-[360px] max-w-[calc(100vw-3rem)] pointer-events-none">
          <AnimatePresence initial={false}>
            {toasts.map((t) => {
              const a = ACCENT[t.type];
              const Icon = a.icon;
              return (
                <motion.div
                  key={t.id}
                  layout
                  initial={{ opacity: 0, x: 40, scale: 0.96 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 40, scale: 0.96 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="glass-strong rounded-2xl overflow-hidden pointer-events-auto"
                >
                  <div className={`h-0.5 bg-gradient-to-r ${a.bar}`} />
                  <div className="flex items-start gap-3 p-4">
                    <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${a.color} ${t.type === 'loading' ? 'animate-spin' : ''}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white leading-snug">{t.title}</p>
                      {t.description && (
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{t.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => dismiss(t.id)}
                      className="p-1 -m-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors shrink-0"
                      aria-label="Dismiss"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
