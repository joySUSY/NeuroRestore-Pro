
import React, { useEffect, useState, useMemo } from 'react';
import { AppMode, AnalysisResult } from '../types';

interface ProcessingOverlayProps {
  mode: AppMode;
  isVisible: boolean;
  analysis?: AnalysisResult | null;
  physicsLogs?: string[];
  onCancel?: () => void;
}

const BASE_STEPS: Record<string, string[]> = {
  [AppMode.RESTORATION]: [
    "Initializing Cognitive Perception...",
    "Scanning Global Physics (Noise/Blur)...",
    "Building Semantic Atlas...",
    "Injecting Text-Prior Embeddings...",
    "Synthesizing Neural Texture...",
    "Finalizing PDSR Reconstruction...",
    "THE JUDGE: Verifying Consistency...",
    "SURGICAL LOOP: Refining Failed Regions...",
    "Polishing Final Output..."
  ],
  [AppMode.INPAINTING]: [
    "Analyzing Contextual Surroundings...",
    "Generating Texture Synthesis...",
    "Blending Mask Boundaries...",
    "Harmonizing Light & Shadow..."
  ],
  [AppMode.GENERATION]: [
    "Parsing Prompt Semantics...",
    "Diffusion Process Initiated...",
    "Refining Latent Space...",
    "Upscaling Output..."
  ]
};

const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({ mode, isVisible, analysis, physicsLogs, onCancel }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const dynamicSteps = useMemo(() => {
     return [...(BASE_STEPS[mode] || BASE_STEPS[AppMode.RESTORATION])];
  }, [mode]);

  useEffect(() => {
    if (!isVisible) {
      setLogs([]);
      setCurrentStep(0);
      return;
    }

    setLogs([dynamicSteps[0]]);
    setCurrentStep(0);

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < dynamicSteps.length - 1) {
          const next = prev + 1;
          setLogs(old => {
              const newLogs = [...old, dynamicSteps[next]];
              return newLogs.slice(-5);
          });
          return next;
        }
        return prev;
      });
    }, 2000); // Slower steps for more realism given the complexity

    return () => clearInterval(interval);
  }, [isVisible, dynamicSteps]);

  useEffect(() => {
      if (physicsLogs && physicsLogs.length > 0) {
          setLogs(physicsLogs.slice(-5));
      }
  }, [physicsLogs]);

  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-md rounded-3xl animate-fade-in">
      <div className="w-96 p-6 glass-panel rounded-2xl shadow-2xl border border-white/80">
        
        <div className="flex justify-center mb-6">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 border-4 border-gray-200 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-morandi-dark border-t-transparent rounded-full animate-spin"></div>
          </div>
        </div>

        <h3 className="text-center text-xs font-bold uppercase tracking-widest text-morandi-dark mb-4">
          Neuro Engine Active
        </h3>

        <div className="bg-gray-50 rounded-lg p-3 h-40 overflow-hidden flex flex-col justify-end border border-gray-100 shadow-inner">
          <div className="flex flex-col gap-1.5 transition-all">
            {logs.map((log, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-gray-600 animate-slide-up">
                <span className={`w-1.5 h-1.5 rounded-full ${i === logs.length - 1 ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></span>
                <span className={i === logs.length - 1 ? 'font-bold text-morandi-dark' : ''}>{log}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-center">
            <button 
                onClick={onCancel}
                className="px-5 py-2 bg-white border border-gray-200 text-[10px] font-bold text-gray-400 rounded-full hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all shadow-sm uppercase tracking-wider"
            >
                Cancel Operation
            </button>
        </div>

        <div className="mt-3 text-center">
             <span className="text-[9px] text-gray-400 font-medium">Powered by Gemini 3.0 Pro Vision</span>
        </div>
      </div>
    </div>
  );
};

export default ProcessingOverlay;
