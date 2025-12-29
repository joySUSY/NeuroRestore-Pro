import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { MaskBlendMode } from '../types';

interface CanvasEditorProps {
  imageSrc: string;
  brushSize: number;
  maskBlendMode: MaskBlendMode;
  className?: string;
  onImageUpdate?: (newImage: string) => void;
}

export interface CanvasEditorRef {
  getImageData: () => string;
  expandCanvas: (direction: 'all' | 'horizontal' | 'vertical', amountPercent: number) => void;
  clearMask: () => void;
  resetCanvas: () => void;
}

interface Point {
    x: number;
    y: number;
    size: number;
}

interface PathLayer {
    points: Point[];
    mode: MaskBlendMode;
}

const CanvasEditor = forwardRef<CanvasEditorRef, CanvasEditorProps>(({ imageSrc, brushSize, maskBlendMode, className, onImageUpdate }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null); // Offscreen mask canvas
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
  
  // Store the "current" base image (without mask) state
  const [currentBaseImage, setCurrentBaseImage] = useState<HTMLImageElement | null>(null);
  
  // Store mask paths for redraw
  const [paths, setPaths] = useState<PathLayer[]>([]);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  // Initialize Canvas with Image
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageSrc;
    img.onload = () => {
      setCurrentBaseImage(img);
      // Reset paths when a fresh image loads from outside
      if (paths.length === 0) { 
        initCanvas(img); 
      }
    };
  }, [imageSrc]);

  const initCanvas = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    canvas.width = img.width;
    canvas.height = img.height;
    
    // Initialize offscreen mask canvas
    const mCanvas = document.createElement('canvas');
    mCanvas.width = img.width;
    mCanvas.height = img.height;
    maskCanvasRef.current = mCanvas;
    
    const context = canvas.getContext('2d');
    if (context) {
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.drawImage(img, 0, 0);
      setCtx(context);
    }
  };

  // Helper to draw a single path onto a context
  const drawPath = (context: CanvasRenderingContext2D, points: Point[]) => {
      if (points.length === 0) return;
      context.beginPath();
      if (points.length === 1) {
          context.arc(points[0].x, points[0].y, points[0].size / 2, 0, Math.PI * 2);
          context.fill();
      } else {
          context.lineWidth = points[0].size;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            context.lineTo(points[i].x, points[i].y);
          }
          context.stroke();
      }
  };

  // Redraw: Base Image + Mask Layer Composition
  const redraw = (context: CanvasRenderingContext2D, baseImg: HTMLImageElement, savedPaths: PathLayer[], currentPts: Point[], currentMode: MaskBlendMode) => {
    // 1. Clear Main Canvas
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    
    // 2. Draw Checkered Background (for transparency visualization)
    const gridSize = 20;
    for (let i=0; i < context.canvas.width; i+=gridSize) {
        for(let j=0; j < context.canvas.height; j+=gridSize) {
            context.fillStyle = (i/gridSize + j/gridSize) % 2 === 0 ? '#333' : '#444';
            context.fillRect(i, j, gridSize, gridSize);
        }
    }

    // 3. Draw Base Image
    context.globalAlpha = 1.0;
    context.globalCompositeOperation = 'source-over';
    context.drawImage(baseImg, 0, 0);

    // 4. Compute Mask Layer (Offscreen)
    // We rebuild the mask from scratch for correctness with blends
    const mCanvas = maskCanvasRef.current;
    if (!mCanvas) return;
    const mCtx = mCanvas.getContext('2d');
    if (!mCtx) return;

    mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height);
    
    // Internal Mask Color (Opaque for logic)
    // We use red because that's the final visual we want, but logic relies on alpha mainly.
    // 'add' = source-over
    // 'subtract' = destination-out
    // 'intersect' = destination-in
    
    mCtx.fillStyle = '#ff0000';
    mCtx.strokeStyle = '#ff0000';

    const allPaths = [...savedPaths];
    if (currentPts.length > 0) {
        allPaths.push({ points: currentPts, mode: currentMode });
    }

    allPaths.forEach(layer => {
        if (layer.mode === 'add') mCtx.globalCompositeOperation = 'source-over';
        else if (layer.mode === 'subtract') mCtx.globalCompositeOperation = 'destination-out';
        else if (layer.mode === 'intersect') mCtx.globalCompositeOperation = 'destination-in';
        
        drawPath(mCtx, layer.points);
    });

    // 5. Draw Mask Layer onto Main Canvas
    // Apply visual transparency for the user
    context.globalAlpha = 0.5; 
    context.globalCompositeOperation = 'source-over';
    context.drawImage(mCanvas, 0, 0);
    
    // Reset Main Context
    context.globalAlpha = 1.0;
  };

  // Interaction Handlers
  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const point = { ...getCoords(e), size: brushSize };
    setCurrentPoints([point]);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !ctx || !currentBaseImage) return;
    e.preventDefault(); 
    
    const point = { ...getCoords(e), size: brushSize };
    const newPoints = [...currentPoints, point];
    setCurrentPoints(newPoints);
    
    redraw(ctx, currentBaseImage, paths, newPoints, maskBlendMode);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentPoints.length > 0) {
        setPaths(prev => [...prev, { points: currentPoints, mode: maskBlendMode }]);
    }
    setCurrentPoints([]);
  };

  // Imperative Handle
  useImperativeHandle(ref, () => ({
    getImageData: () => {
      return canvasRef.current?.toDataURL('image/png') || '';
    },
    expandCanvas: (direction, amountPercent) => {
      if (!currentBaseImage || !canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const oldWidth = canvas.width;
      const oldHeight = canvas.height;
      
      let newWidth = oldWidth;
      let newHeight = oldHeight;
      let offsetX = 0;
      let offsetY = 0;

      const expansionFactor = 1 + (amountPercent / 100);

      if (direction === 'all' || direction === 'horizontal') {
        newWidth = Math.round(oldWidth * expansionFactor);
        offsetX = Math.round((newWidth - oldWidth) / 2);
      }
      if (direction === 'all' || direction === 'vertical') {
        newHeight = Math.round(oldHeight * expansionFactor);
        offsetY = Math.round((newHeight - oldHeight) / 2);
      }

      // Create temp canvas to bake EVERYTHING (Image + Mask) into a new Base Image
      // NOTE: This "bakes" the mask. If you want to keep the mask editable after expansion, 
      // you would need to expand the maskCanvas separately. 
      // For simplicity in this interaction, we bake the current view state as the new "source" 
      // for the next step, which is intuitive for "Expand Canvas then fill it".
      
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = newWidth;
      tempCanvas.height = newHeight;
      const tCtx = tempCanvas.getContext('2d');
      if (!tCtx) return;

      // Draw current canvas state into center
      tCtx.drawImage(canvas, offsetX, offsetY);

      const newImg = new Image();
      newImg.onload = () => {
        setCurrentBaseImage(newImg);
        initCanvas(newImg); 
        setPaths([]); // Mask is baked into the image as red overlay or transparency depending on logic
      };
      newImg.src = tempCanvas.toDataURL();
    },
    clearMask: () => {
        setPaths([]);
        if (ctx && currentBaseImage) redraw(ctx, currentBaseImage, [], [], 'add');
    },
    resetCanvas: () => {
        setPaths([]);
        const img = new Image();
        img.src = imageSrc;
        img.onload = () => {
            setCurrentBaseImage(img);
            initCanvas(img);
        };
    }
  }));

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain cursor-crosshair touch-none"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      <div className="absolute top-4 left-4 pointer-events-none bg-black/50 backdrop-blur px-2 py-1 rounded text-[10px] text-gray-300 font-mono flex gap-2">
         <span>CANVAS EDITOR</span>
         <span className="text-cyan-400 font-bold uppercase">{maskBlendMode} MODE</span>
      </div>
    </div>
  );
});

export default CanvasEditor;
