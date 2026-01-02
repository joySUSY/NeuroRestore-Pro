
export enum AppMode {
  RESTORATION = 'RESTORATION',
  GENERATION = 'GENERATION',
  INPAINTING = 'INPAINTING',
  VECTORIZATION = 'VECTORIZATION',
  EXTRACT_TEXT = 'EXTRACT_TEXT',
  ANALYSIS = 'ANALYSIS'
}

export enum ImageType {
  DOCUMENT = 'DOCUMENT',
  DIGITAL_ART = 'DIGITAL_ART',
  PHOTO = 'PHOTO'
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
  TRUE_TONE = 'TRUE_TONE',
  HIGH_CONTRAST = 'HIGH_CONTRAST',
  VIBRANT_HDR = 'VIBRANT_HDR',
  BLACK_WHITE = 'BLACK_WHITE',
  VINTAGE_WARM = 'VINTAGE_WARM',
  COOL_TONE = 'COOL_TONE'
}

export type MaskBlendMode = 'add' | 'subtract' | 'intersect';

export interface PhysicsConfig {
  enableDewarping: boolean; // DocTr: 3D Geometric Unwarping
  enableIntrinsic: boolean; // PIDNet: Intrinsic Image Decomposition (Shadow Removal)
  enableDiffVG: boolean;    // DiffVG: Differentiable Vector Graphics Optimization
}

export interface RestorationConfig {
  imageType: ImageType;
  customPrompt: string;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  colorStyle: ColorStyle;
  referenceImage?: string;
  detailEnhancement: 'OFF' | 'BALANCED' | 'MAX';
  // Physics Core
  physics: PhysicsConfig;
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
  colorProfile?: string;
  detectedType?: ImageType;
  detectedMaterial?: string;
  requiresDescreening?: boolean;
  description?: string;
  dominantColors?: string[];
  detectedWatermarks?: string[];
}

export interface ProcessingState {
  isProcessing: boolean;
  stage: 'idle' | 'analyzing' | 'dewarping' | 'intrinsic' | 'restoring' | 'generating' | 'inpainting' | 'vectorizing' | 'extracting_text' | 'complete' | 'error';
  error: string | null;
  progressMessage: string;
}
