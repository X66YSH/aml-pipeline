/**
 * useSettings — persists pipeline settings to localStorage.
 * Import this hook anywhere to read or update settings.
 */

import { useState, useCallback } from 'react';

export interface AppSettings {
  model: string;
  temperature: string;
  max_corrections: string;
  timeout: string;
  sample_rows: string;
  max_exec_rows: string;
}

const STORAGE_KEY = 'aml_pipeline_settings';

const DEFAULTS: AppSettings = {
  model: 'gpt-4o',
  temperature: '0',
  max_corrections: '5',
  timeout: '120',
  sample_rows: '50000',
  max_exec_rows: '100000',
};

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(load);

  const setSettings = useCallback((next: Partial<AppSettings>) => {
    setSettingsState(prev => {
      const updated = { ...prev, ...next };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { settings, setSettings };
}

/** Read settings once without React state (for use outside components). */
export function readSettings(): AppSettings {
  return load();
}
