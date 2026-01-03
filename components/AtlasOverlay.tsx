
import React from 'react';
import { SemanticAtlas, ValidationReport } from '../types';

interface AtlasOverlayProps {
  atlas: SemanticAtlas | null;
  report: ValidationReport | null;
  isVisible: boolean;
  imgRef: React.RefObject<HTMLImageElement | null>;
}

const AtlasOverlay: React.FC<AtlasOverlayProps> = ({ atlas, report, isVisible, imgRef }) => {
  if (!isVisible || !atlas || !imgRef.current) return null;

  const img = imgRef.current;
  // We assume the bounding boxes are 0-1000 normalized.
  // We need to map them to the current display size of the image.
  
  const width = img.clientWidth;
  const height = img.clientHeight;

  // Helper to get color based on status
  const getStatusColor = (regionId: string) => {
      if (!report) return 'rgba(59, 130, 246, 0.4)'; // Default Blue
      const result = report.results.find(r => r.regionId === regionId);
      if (!result) return 'rgba(156, 163, 175, 0.3)'; // Gray for unchecked
      return result.status === 'PASS' 
        ? 'rgba(34, 197, 94, 0.5)' // Green
        : 'rgba(239, 68, 68, 0.6)'; // Red
  };

  const getStatusBorder = (regionId: string) => {
    if (!report) return '1px solid #3b82f6';
    const result = report.results.find(r => r.regionId === regionId);
    if (!result) return '1px dashed #9ca3af';
    return result.status === 'PASS' ? '2px solid #22c55e' : '2px solid #ef4444';
  };

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-10 overflow-hidden">
      {atlas.regions.map((region) => {
        // [ymin, xmin, ymax, xmax]
        const ymin = (region.bbox[0] / 1000) * height;
        const xmin = (region.bbox[1] / 1000) * width;
        const ymax = (region.bbox[2] / 1000) * height;
        const xmax = (region.bbox[3] / 1000) * width;
        
        const boxW = xmax - xmin;
        const boxH = ymax - ymin;

        const result = report?.results.find(r => r.regionId === region.id);

        return (
          <div
            key={region.id}
            className="absolute flex items-start justify-start group"
            style={{
              top: ymin,
              left: xmin,
              width: boxW,
              height: boxH,
              backgroundColor: getStatusColor(region.id),
              border: getStatusBorder(region.id),
              transition: 'all 0.3s ease'
            }}
          >
             {/* Tooltip on Hover (requires pointer-events-auto on child if parent is none, but we set overlay to none) 
                 Actually, let's make the box interactive if needed, but for now purely visual.
             */}
             <div className="bg-black/70 text-white text-[8px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap -mt-4">
                {region.semanticType} {result ? `(${result.status})` : ''}
             </div>
             
             {result && result.status === 'FAIL' && (
                 <div className="absolute -bottom-5 left-0 bg-red-600 text-white text-[8px] px-1 py-0.5 rounded shadow-sm whitespace-nowrap">
                     Fixing: {result.reason}
                 </div>
             )}
          </div>
        );
      })}
    </div>
  );
};

export default AtlasOverlay;
