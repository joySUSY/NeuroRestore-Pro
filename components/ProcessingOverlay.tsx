import React, { useEffect, useState, useMemo } from 'react';
import { AppMode, AnalysisResult } from '../types';

interface ProcessingOverlayProps {
  mode: AppMode;
  isVisible: boolean;
  analysis?: AnalysisResult | null;
}

const BASE_STEPS: Record<string, string[]> = {
  [AppMode.RESTORATION]: [
    "Analyzing Frequency Spectrum...",
    "Detecting Halftone Patterns...",
    "Synthesizing High-Frequency Detail...",
    "Color Grading & Tone Mapping...",
    "Finalizing Texture Reconstruction..."
  ],
  [AppMode.VECTORIZATION]: [
    "Tracing Luma Gradients...",
    "Detecting Geometric Primitives...",
    "Optimizing Bezier Curves...",
    "Simplifying Node Topology...",
    "Grouping Semantic Layers...",
    "Generating XML Structure..."
  ],
  [AppMode.EXTRACT_TEXT]: [
    "Scanning Optical Characters...",
    "Identifying Font Families...",
    "Calculating Kerning & Tracking...",
    "Isolating Glyph Geometry...",
    "Generating Transparent Overlay..."
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

const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({ mode, isVisible, analysis }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  // Dynamically generate steps based on analysis
  const dynamicSteps = useMemo(() => {
     const steps = [...(BASE_STEPS[mode] || BASE_STEPS[AppMode.RESTORATION])];
     
     if (mode === AppMode.RESTORATION && analysis) {
         // Insert smart steps based on actual analysis
         if (analysis.requiresDescreening) {
             steps.splice(2, 0, "⚠️ Halftone Detected: Engaging Descreening Matrix...");
         }
         if (analysis.detectedType === 'DOCUMENT') {
             steps.splice(1, 0, "Optimizing Contrast for OCR Legibility...");
         }
         if (analysis.dominantColors && analysis.dominantColors.length > 0) {
             steps.splice(steps.length - 1, 0, `Quantizing to ${analysis.dominantColors.length} Dominant Tones...`);
         }
     }
     return steps;
  }, [mode, analysis]);

  useEffect(() => {
    if (!isVisible) {
      setLogs([]);
      setCurrentStep(0);
      return;
    }

    // Reset
    setLogs([dynamicSteps[0]]);
    setCurrentStep(0);

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < dynamicSteps.length - 1) {
          const next = prev + 1;
          setLogs(old => {
              // Keep only last 4 logs to prevent overflow/clutter, typical terminal style
              const newLogs = [...old, dynamicSteps[next]];
              return newLogs.slice(-5);
          });
          return next;
        }
        return prev;
      });
    }, 1200); // Slightly faster updates for snappier feel

    return () => clearInterval(interval);
  }, [isVisible, dynamicSteps]);

  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-md rounded-3xl animate-fade-in">
      <div className="w-80 p-6 glass-panel rounded-2xl shadow-2xl border border-white/80">
        
        {/* Spinner Icon */}
        <div className="flex justify-center mb-6">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 border-4 border-gray-200 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-morandi-dark border-t-transparent rounded-full animate-spin"></div>
          </div>
        </div>

        {/* Title */}
        <h3 className="text-center text-xs font-bold uppercase tracking-widest text-morandi-dark mb-4">
          Neuro Engine Active
        </h3>

        {/* Log Terminal */}
        <div className="bg-gray-50 rounded-lg p-3 h-32 overflow-hidden flex flex-col justify-end border border-gray-100 shadow-inner">
          <div className="flex flex-col gap-1.5 transition-all">
            {logs.map((log, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-gray-600 animate-slide-up">
                <span className={`w-1.5 h-1.5 rounded-full ${i === logs.length - 1 ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></span>
                <span className={i === logs.length - 1 ? 'font-bold text-morandi-dark' : ''}>{log}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-3 text-center">
             <span className="text-[9px] text-gray-400 font-medium">Processing on Gemini 3.0 Vision Pro</span>
        </div>
      </div>
    </div>
  );
};

export default ProcessingOverlay;