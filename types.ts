
export enum AppMode {
  RESTORATION = 'RESTORATION',
  GENERATION = 'GENERATION',
  INPAINTING = 'INPAINTING',
  VECTORIZATION = 'VECTORIZATION',
  EXTRACT_TEXT = 'EXTRACT_TEXT', // New Mode
  ANALYSIS = 'ANALYSIS'
}

export enum ImageType {
  DOCUMENT = 'DOCUMENT',
  DIGITAL_ART = 'DIGITAL_ART',
  PHOTO = 'PHOTO' // Fallback, though UI prioritizes others
}

export enum AspectRatio {
  ORIGINAL = 'ORIGINAL',
  SQUARE = '1:1',
  PORTRAIT_3_4 = '3:4',
  LANDSCAPE_4_3 = '4:3',
  PORTRAIT_9_16 = '9:16',
  LANDSCAPE_16_9 = '16:9',
  WIDE_21_9 = '21:9'
}

export enum Resolution {
  HD_1K = '1K',
  QHD_2K = '2K',
  UHD_4K = '4K'
}

export enum ColorStyle {
  TRUE_TONE = 'TRUE_TONE',       // Strict fidelity (Default)
  HIGH_CONTRAST = 'HIGH_CONTRAST', // For docs/text clarity
  VIBRANT_HDR = 'VIBRANT_HDR',   // For dull illustrations
  BLACK_WHITE = 'BLACK_WHITE',   // Grayscale restoration
  VINTAGE_WARM = 'VINTAGE_WARM', // Sepia/Retro preservation
  COOL_TONE = 'COOL_TONE'        // Modern/Blue bias
}

export type MaskBlendMode = 'add' | 'subtract' | 'intersect';

export interface RestorationConfig {
  imageType: ImageType;
  customPrompt: string; // For "Add a retro filter" style edits
  resolution: Resolution;
  aspectRatio: AspectRatio; // Only for generation or creative editing
  colorStyle: ColorStyle; // New field
  referenceImage?: string; // Data URL for Style Reference
  // Inpainting specific
  brushSize: number;
  maskBlendMode: MaskBlendMode;
  // Vectorization specific
  vectorDetail: 'LOW' | 'MEDIUM' | 'HIGH';
  vectorColor: 'COLOR' | 'BLACK_WHITE';
}

export interface AnalysisResult {
  issues: string[];
  suggestedFixes: string[];
  rawAnalysis: string;
  colorProfile?: string; // New field for color analysis
  detectedType?: ImageType; // New field for auto-detection
  detectedMaterial?: string; // New field for physical substrate detection (e.g., "Wove Paper", "Holographic")
  requiresDescreening?: boolean; // Critical for scan restoration
  description?: string; // Brief technical description
}

export interface ProcessingState {
  isProcessing: boolean;
  stage: 'idle' | 'analyzing' | 'restoring' | 'generating' | 'inpainting' | 'vectorizing' | 'extracting_text' | 'complete' | 'error';
  error: string | null;
  progressMessage: string;
}
