
import React, { useEffect, useState, useRef } from 'react';
import { AppMode, AnalysisResult } from '../types';

interface ProcessingOverlayProps {
  mode: AppMode;
  isVisible: boolean;
  analysis?: AnalysisResult | null;
  physicsLogs?: string[];
  progress?: number;
  networkStatus?: string;
  latencyMs?: number;
  onCancel?: () => void;
}

const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({ 
  mode, 
  isVisible, 
  physicsLogs, 
  progress = 0, 
  networkStatus = 'IDLE',
  latencyMs = 0,
  onCancel 
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
  }, [physicsLogs]);

  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-morandi-base/80 backdrop-blur-sm animate-fade-in font-mono">
      {/* Container - Using Morandi-compatible Dark Theme for Terminal */}
      <div className="w-[600px] bg-[#2e2c29] border border-morandi-text/20 rounded-xl shadow-2xl overflow-hidden flex flex-col relative ring-1 ring-white/10">
        
        {/* Terminal Header */}
        <div className="h-10 bg-[#252321] border-b border-morandi-text/10 flex items-center justify-between px-4">
            <div className="flex items-center gap-3">
                <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-morandi-red shadow-[0_0_8px_rgba(196,126,126,0.3)]"></div>
                    <div className="w-3 h-3 rounded-full bg-morandi-yellow shadow-[0_0_8px_rgba(217,201,145,0.3)]"></div>
                    <div className="w-3 h-3 rounded-full bg-morandi-green shadow-[0_0_8px_rgba(148,166,135,0.3)]"></div>
                </div>
                <span className="text-[11px] font-bold text-morandi-overlay ml-3 tracking-wider">NEURO_LINK_V3.1 :: <span className="text-morandi-green">CONNECTED</span></span>
            </div>
            <div className="flex items-center gap-3">
                <div className="flex flex-col items-end leading-none">
                     <span className="text-[9px] text-morandi-subtext font-bold">NET: {networkStatus}</span>
                     {latencyMs > 0 && <span className="text-[9px] text-morandi-blue">{latencyMs}ms</span>}
                </div>
                <div className={`w-2 h-2 rounded-full ${networkStatus === 'WAITING' ? 'bg-morandi-yellow animate-pulse' : networkStatus === 'RECEIVING' ? 'bg-morandi-green animate-ping' : 'bg-morandi-subtext'}`}></div>
            </div>
        </div>

        {/* Content Area */}
        <div className="p-8 relative min-h-[320px] flex flex-col">
            
            {/* Background Decoration */}
            <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                 <svg className="w-32 h-32 text-morandi-blue animate-[spin_10s_linear_infinite]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={0.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                 </svg>
            </div>

            <div className="mb-6 relative z-10">
                <div className="flex justify-between items-end mb-2">
                    <h3 className="text-morandi-mauve text-sm font-bold tracking-[0.2em] uppercase flex items-center gap-2">
                        <span className="text-morandi-blue">{`//`}</span> {mode === AppMode.RESTORATION ? 'PDSR_ENGINE' : mode}_PROTOCOL
                    </h3>
                    <span className="text-morandi-surface1 text-xs font-bold">{progress.toFixed(0)}%</span>
                </div>
                
                {/* Progress Bar */}
                <div className="h-1.5 w-full bg-morandi-text/30 rounded-full overflow-hidden mb-1">
                    <div 
                        className="h-full bg-gradient-to-r from-morandi-blue to-morandi-mauve transition-all duration-300 ease-out relative"
                        style={{ width: `${progress}%` }}
                    >
                         <div className="absolute right-0 top-0 bottom-0 w-4 bg-white/20 animate-pulse"></div>
                    </div>
                </div>
                <div className="h-px w-full bg-gradient-to-r from-morandi-blue/30 to-transparent opacity-50"></div>
            </div>

            {/* Terminal Stream */}
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto pr-2 space-y-2 scrollbar-thin scrollbar-thumb-morandi-text/50 scrollbar-track-transparent relative z-10"
            >
                {(!physicsLogs || physicsLogs.length === 0) && (
                    <div className="text-xs text-morandi-subtext italic flex items-center gap-2">
                        <span className="animate-bounce">...</span> Establishing Neural Handshake
                    </div>
                )}
                {physicsLogs?.map((log, i) => (
                    <div key={i} className="text-[11px] text-morandi-base leading-relaxed flex items-start gap-3 animate-slide-up border-l-2 border-transparent hover:border-morandi-blue/30 pl-2 transition-colors">
                        <span className="text-morandi-blue font-bold mt-[1px] opacity-70">{`>`}</span>
                        <span>
                            {log.split(' ').map((word, idx) => {
                                const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '');
                                const isKeyword = word.startsWith('"') || (word.toUpperCase() === word && cleanWord.length > 2);
                                const isNumber = !isNaN(parseFloat(word));
                                
                                if (isKeyword) return <span key={idx} className="text-morandi-blue font-bold">{word} </span>;
                                if (isNumber) return <span key={idx} className="text-morandi-yellow font-mono">{word} </span>;
                                return <span key={idx} className={word.includes('Error') || word.includes('Fail') ? 'text-morandi-red' : ''}>{word} </span>
                            })}
                        </span>
                    </div>
                ))}
            </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-morandi-text/10 bg-[#252321] flex justify-between items-center">
             <div className="text-[10px] text-morandi-subtext font-mono flex gap-4">
                 <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-morandi-mauve"></span> RAM: 32GB</span>
                 <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-morandi-yellow"></span> GPU: H100</span>
             </div>
             <button 
                onClick={onCancel}
                className="text-[10px] font-bold text-morandi-red hover:text-white hover:bg-morandi-red/20 px-4 py-2 rounded transition-all uppercase border border-morandi-red/30 tracking-wider flex items-center gap-2"
            >
                <span className="text-lg leading-none">×</span> Abort
            </button>
        </div>
      </div>
    </div>
  );
};

export default ProcessingOverlay;
