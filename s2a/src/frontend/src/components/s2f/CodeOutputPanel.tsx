import { useEffect, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';

interface Props {
  code: string;
  iteration: number;
}

export default function CodeOutputPanel({ code, iteration }: Props) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
  };

  if (!code) {
    return (
      <div className="flex-1 bg-[var(--color-bg-code)] border border-slate-700 rounded-lg flex items-center justify-center">
        <p className="text-slate-500 text-sm">Generated code will appear here...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[var(--color-bg-code)] border border-slate-700 rounded-lg overflow-hidden flex flex-col">
      <div className="bg-slate-800/50 px-3 py-1.5 border-b border-slate-700 flex justify-between items-center shrink-0">
        <span className="text-[10px] font-mono text-slate-400">
          Generated Python
          {iteration > 0 && <span className="text-amber-400 ml-2">({iteration} correction{iteration > 1 ? 's' : ''})</span>}
        </span>
        <button
          onClick={handleCopy}
          className="text-[10px] bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded transition text-slate-300"
        >
          Copy
        </button>
      </div>
      <div className="p-3 overflow-y-auto flex-1">
        <pre className="text-[11px] leading-relaxed !bg-transparent !m-0 !p-0">
          <code ref={codeRef} className="language-python">
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}
