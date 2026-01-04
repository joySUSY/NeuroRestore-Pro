
import React, { useState } from 'react';
import { SemanticAtlas, ValidationReport } from '../types';

interface AtlasOverlayProps {
  atlas: SemanticAtlas | null;
  report: ValidationReport | null;
  isVisible: boolean;
  imgRef: React.RefObject<HTMLImageElement | null>;
}

const AtlasOverlay: React.FC<AtlasOverlayProps> = ({ atlas, report, isVisible, imgRef }) => {
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);

  if (!isVisible || !atlas || !imgRef.current) return null;

  const img = imgRef.current;
  const width = img.clientWidth;
  const height = img.clientHeight;

  // Helper to get color based on status and type using Dracula Palette
  const getStyles = (regionId: string, type: string) => {
      // Default: Dracula Cyan
      let borderColor = '#8be9fd'; 
      let bgColor = 'rgba(139, 233, 253, 0.15)';
      
      // If validation ran, status overrides type
      if (report) {
          const result = report.results.find(r => r.regionId === regionId);
          if (result) {
              if (result.status === 'PASS') {
                  borderColor = '#50fa7b'; // Dracula Green
                  bgColor = 'rgba(80, 250, 123, 0.15)';
              } else {
                  borderColor = '#ff5555'; // Dracula Red
                  bgColor = 'rgba(255, 85, 85, 0.3)';
              }
          } else {
             borderColor = '#6272a4'; // Dracula Comment (Gray/Blue)
             bgColor = 'rgba(98, 114, 164, 0.1)';
          }
      } else {
          // No validation yet, color by type
          if (type === 'STAMP_PIGMENT') { borderColor = '#ff79c6'; bgColor = 'rgba(255, 121, 198, 0.15)'; } // Dracula Pink
          if (type === 'BACKGROUND_STAIN') { borderColor = '#ffb86c'; bgColor = 'rgba(255, 184, 108, 0.15)'; } // Dracula Orange
          if (type === 'TEXT_INK') { borderColor = '#8be9fd'; bgColor = 'rgba(139, 233, 253, 0.1)'; } // Dracula Cyan
      }

      return { borderColor, bgColor };
  };

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-10 overflow-hidden font-mono">
      
      {/* GLOBAL PHYSICS HUD (Top Left) - Dracula Theme */}
      <div className="absolute top-4 left-4 flex flex-col gap-1 pointer-events-auto">
          <div className="bg-dracula-bg/90 backdrop-blur-md border border-dracula-curr text-dracula-fg p-4 rounded-lg shadow-2xl animate-fade-in max-w-xs ring-1 ring-white/10">
              <div className="flex items-center gap-2 mb-3 border-b border-dracula-curr pb-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-dracula-purple animate-pulse shadow-[0_0_8px_#bd93f9]"></div>
                  <span className="text-[11px] font-bold tracking-widest uppercase text-dracula-purple">Mind's Eye Active</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[10px] text-dracula-comment">
                  <span className="opacity-80">Substrate:</span>
                  <span className="font-bold text-dracula-fg text-right font-mono">{atlas.globalPhysics.paperWhitePoint}</span>
                  
                  <span className="opacity-80">Noise Profile:</span>
                  <span className="font-bold text-dracula-fg text-right">{atlas.globalPhysics.noiseProfile}</span>
                  
                  <span className="opacity-80">Blur Kernel:</span>
                  <span className="font-bold text-dracula-fg text-right">{atlas.globalPhysics.blurKernel}</span>
                  
                  <span className="opacity-80">Degradation:</span>
                  <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-dracula-curr rounded-full overflow-hidden">
                          <div className="h-full bg-dracula-red" style={{ width: `${atlas.degradationScore}%` }}></div>
                      </div>
                      <span className="font-bold text-dracula-red">{atlas.degradationScore}%</span>
                  </div>
              </div>
          </div>
      </div>

      {/* SEMANTIC REGIONS */}
      {atlas.regions.map((region) => {
        // Safety check: Ensure bbox exists and has 4 elements before accessing indices
        if (!region.bbox || !Array.isArray(region.bbox) || region.bbox.length < 4) {
            return null;
        }

        // [ymin, xmin, ymax, xmax] -> 0-1000 scale
        const ymin = (region.bbox[0] / 1000) * height;
        const xmin = (region.bbox[1] / 1000) * width;
        const ymax = (region.bbox[2] / 1000) * height;
        const xmax = (region.bbox[3] / 1000) * width;
        
        const boxW = xmax - xmin;
        const boxH = ymax - ymin;

        const result = report?.results.find(r => r.regionId === region.id);
        const { borderColor, bgColor } = getStyles(region.id, region.semanticType);
        const isHovered = hoveredRegion === region.id;

        return (
          <div
            key={region.id}
            className="absolute flex items-start justify-start pointer-events-auto transition-all duration-200 group"
            style={{
              top: ymin,
              left: xmin,
              width: boxW,
              height: boxH,
              backgroundColor: isHovered ? bgColor.replace('0.15', '0.3') : bgColor,
              border: `1px solid ${borderColor}`,
              boxShadow: isHovered ? `0 0 15px ${borderColor}` : 'none',
              zIndex: isHovered ? 20 : 10
            }}
            onMouseEnter={() => setHoveredRegion(region.id)}
            onMouseLeave={() => setHoveredRegion(null)}
          >
             {/* Region Label Tag */}
             <div 
                className="absolute -top-5 left-0 text-[9px] font-bold px-1.5 py-0.5 rounded-t text-dracula-bg flex items-center gap-1 transition-all opacity-0 group-hover:opacity-100"
                style={{ backgroundColor: borderColor }}
             >
                <span>{region.id}</span>
                <span className="opacity-75">| {region.semanticType.replace('_', ' ')}</span>
             </div>
             
             {/* HOVER: Deep Semantic Data (Ground Truth) */}
             {isHovered && (
                 <div className="absolute top-full left-0 mt-1 bg-dracula-bg/95 backdrop-blur text-dracula-fg p-3 rounded shadow-2xl border border-dracula-comment min-w-[240px] z-50 animate-fade-in ring-1 ring-white/10">
                     <div className="text-[10px] uppercase tracking-wider text-dracula-comment mb-1 font-bold">Semantic Ground Truth</div>
                     <div className="text-sm font-mono font-bold text-dracula-green break-words leading-snug border-l-2 border-dracula-green pl-2">
                        "{region.content}"
                     </div>
                     <div className="mt-3 pt-2 border-t border-dracula-curr flex justify-between items-center">
                         <span className="text-[10px] text-dracula-purple font-bold">Confidence: {(region.confidence * 100).toFixed(0)}%</span>
                         {result && (
                             <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${result.status === 'PASS' ? 'bg-dracula-green/20 text-dracula-green' : 'bg-dracula-red/20 text-dracula-red'}`}>
                                 {result.status}
                             </span>
                         )}
                     </div>
                     {result && result.status === 'FAIL' && (
                         <div className="mt-2 text-[10px] text-dracula-red bg-dracula-red/10 p-1.5 rounded border border-dracula-red/20">
                             <strong>Diagnosis:</strong> {result.reason}
                         </div>
                     )}
                 </div>
             )}

             {/* Failed Indicator Pulse */}
             {result && result.status === 'FAIL' && !isHovered && (
                 <div className="absolute inset-0 border-2 border-dracula-red animate-pulse bg-dracula-red/10"></div>
             )}
          </div>
        );
      })}
    </div>
  );
};

export default AtlasOverlay;
