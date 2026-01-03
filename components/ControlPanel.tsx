
import React, { useState, useEffect } from 'react';
import { AppMode, ImageType, Resolution, AspectRatio, RestorationConfig, MaskBlendMode, ColorStyle } from '../types';

interface ControlPanelProps {
  config: RestorationConfig;
  setConfig: React.Dispatch<React.SetStateAction<RestorationConfig>>;
  onProcess: () => void;
  isProcessing: boolean;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  disabled?: boolean;
  onExpand?: (direction: 'all') => void;
  onClearMask?: () => void;
  onChangeKey?: () => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  config, 
  setConfig, 
  onProcess, 
  isProcessing,
  mode,
  setMode,
  disabled,
  onExpand,
  onClearMask,
  onChangeKey
}) => {
  
  const [tooltip, setTooltip] = useState<string | null>(null);

  const handleChange = (key: keyof RestorationConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };
  
  const handlePDSRChange = (key: keyof RestorationConfig['pdsr'], value: boolean) => {
      setConfig(prev => ({ ...prev, pdsr: { ...prev.pdsr, [key]: value } }));
  };

  const SegmentButton = ({ label, active, onClick, extraClass = "", tooltipText }: { label: string, active: boolean, onClick: () => void, extraClass?: string, tooltipText: string }) => (
    <button 
        onClick={onClick}
        onMouseEnter={() => setTooltip(tooltipText)}
        onMouseLeave={() => setTooltip(null)}
        className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${
            active 
            ? 'bg-morandi-dark text-white shadow-soft transform scale-100' 
            : 'text-gray-500 hover:bg-black/5 hover:text-gray-700'
        } ${extraClass}`}
    >
        {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full glass-panel w-96 p-8 overflow-y-auto rounded-r-3xl border-r border-morandi-glassBorder/50 shadow-glass z-10 relative">
      
      {/* Header */}
      <div className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-morandi-blue to-morandi-green flex items-center justify-center shadow-lg text-white">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                </svg>
            </div>
            <div>
                <h1 className="text-xl font-bold text-morandi-dark tracking-tight">
                NeuroRestore
                </h1>
                <p className="text-[10px] text-gray-500 font-medium tracking-wide uppercase">PDSR Engine</p>
            </div>
        </div>
        {onChangeKey && (
            <button 
                onClick={onChangeKey}
                className="p-2 rounded-full hover:bg-black/5 text-gray-400 hover:text-morandi-dark transition-colors"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
        )}
      </div>

      <div className="space-y-8">
        
        {/* Mode Selector */}
        <div className="p-1.5 bg-gray-100/50 rounded-xl flex flex-wrap gap-1 shadow-inner-light">
            <SegmentButton label="Restore (PDSR)" active={mode === AppMode.RESTORATION} onClick={() => setMode(AppMode.RESTORATION)} tooltipText="Perception-Driven Semantic Restoration." />
            <SegmentButton label="Edit" active={mode === AppMode.INPAINTING} onClick={() => setMode(AppMode.INPAINTING)} tooltipText="Smart Inpainting & Object Removal." />
            <SegmentButton label="Create" active={mode === AppMode.GENERATION} onClick={() => setMode(AppMode.GENERATION)} extraClass="w-full mt-1" tooltipText="Generate new images from prompts." />
        </div>

        <div className="space-y-6 animate-fade-in">
            
            {/* PDSR CONTROLS */}
            {(mode === AppMode.RESTORATION) && (
                <div className="p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100 shadow-soft space-y-4">
                     <h3 className="text-xs font-bold text-indigo-800 uppercase tracking-wider flex items-center gap-2">
                         <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                         Perception Core
                     </h3>
                     
                     <div className="space-y-3">
                         <div 
                            className="flex items-center justify-between cursor-pointer"
                            onMouseEnter={() => setTooltip("Use recognized text content (OCR) to guide super-resolution sharpness.")}
                            onMouseLeave={() => setTooltip(null)}
                            onClick={() => handlePDSRChange('enableTextPriors', !config.pdsr.enableTextPriors)}
                         >
                            <span className="text-[10px] font-medium text-gray-600">Text-Prior Injection</span>
                            <button className={`w-8 h-4 rounded-full p-0.5 transition-colors ${config.pdsr.enableTextPriors ? 'bg-indigo-500' : 'bg-gray-200'}`}>
                                <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${config.pdsr.enableTextPriors ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                         </div>

                         <div 
                            className="flex items-center justify-between cursor-pointer"
                            onMouseEnter={() => setTooltip("Use clean background patches to synthesize authentic paper grain (NTT).")}
                            onMouseLeave={() => setTooltip(null)}
                            onClick={() => handlePDSRChange('enableTextureTransfer', !config.pdsr.enableTextureTransfer)}
                         >
                            <span className="text-[10px] font-medium text-gray-600">Neural Texture Transfer</span>
                            <button className={`w-8 h-4 rounded-full p-0.5 transition-colors ${config.pdsr.enableTextureTransfer ? 'bg-indigo-500' : 'bg-gray-200'}`}>
                                <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${config.pdsr.enableTextureTransfer ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                         </div>

                         <div 
                            className="flex items-center justify-between cursor-pointer"
                            onMouseEnter={() => setTooltip("Identify and heal tears, stains, and creases using context.")}
                            onMouseLeave={() => setTooltip(null)}
                            onClick={() => handlePDSRChange('enableSemanticRepair', !config.pdsr.enableSemanticRepair)}
                         >
                            <span className="text-[10px] font-medium text-gray-600">Semantic Damage Repair</span>
                            <button className={`w-8 h-4 rounded-full p-0.5 transition-colors ${config.pdsr.enableSemanticRepair ? 'bg-indigo-500' : 'bg-gray-200'}`}>
                                <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${config.pdsr.enableSemanticRepair ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                         </div>
                     </div>
                </div>
            )}

            {/* GENERATION / EDITING COMMON CONFIG */}
            <div className="space-y-4">
                 <div className="flex justify-between items-center mb-1">
                     <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Output Quality</h3>
                 </div>
                 <div className="grid grid-cols-3 gap-2">
                    {Object.values(Resolution).map((res) => (
                        <button
                            key={res}
                            onClick={() => handleChange('resolution', res)}
                            className={`py-2 rounded-lg text-[10px] font-bold border transition-all ${
                                config.resolution === res
                                ? 'bg-white border-morandi-dark text-morandi-dark shadow-sm'
                                : 'bg-transparent border-gray-200 text-gray-400'
                            }`}
                        >
                            {res}
                        </button>
                    ))}
                 </div>
            </div>
            
            {/* Custom Prompt Input */}
            <div>
                 <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                    {mode === AppMode.GENERATION ? 'Creative Prompt' : 'Specific Instructions'}
                 </h3>
                 <textarea 
                    value={config.customPrompt}
                    onChange={(e) => handleChange('customPrompt', e.target.value)}
                    placeholder={mode === AppMode.GENERATION ? "Describe the image you want to create..." : "e.g., 'Make the text sharper', 'Remove coffee stain'..."}
                    className="w-full h-24 p-3 bg-white/50 rounded-xl border border-gray-200 text-xs text-morandi-dark focus:outline-none focus:bg-white focus:border-morandi-blue focus:ring-1 focus:ring-morandi-blue transition-all resize-none placeholder:text-gray-400"
                 />
            </div>

        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-gray-200/50">
             <button 
                onClick={onProcess}
                disabled={isProcessing || disabled}
                className={`w-full py-4 rounded-xl text-sm font-bold tracking-wide shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 ${
                    isProcessing || disabled
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                    : 'bg-morandi-dark text-white hover:bg-black hover:shadow-xl'
                }`}
             >
                 {isProcessing ? (
                     <>
                        <svg className="animate-spin h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Processing...</span>
                     </>
                 ) : (
                     <>
                        <span>
                            {mode === AppMode.RESTORATION ? 'Execute PDSR' : 
                             mode === AppMode.INPAINTING ? 'Fill Selected Area' :
                             'Generate'}
                        </span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                     </>
                 )}
             </button>
             
             <div className="mt-3 h-4 flex items-center justify-center">
                 {tooltip && (
                     <span className="text-[10px] text-morandi-blue font-medium animate-fade-in">{tooltip}</span>
                 )}
             </div>
        </div>

      </div>
    </div>
  );
};

export default ControlPanel;
