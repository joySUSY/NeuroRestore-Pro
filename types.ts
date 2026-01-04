
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

export type InkType = 'LASER' | 'INKJET' | 'BALLPOINT' | 'MARKER' | 'UNKNOWN';
export type PaperType = 'PLAIN' | 'GLOSSY' | 'TEXTURED' | 'PARCHMENT' | 'UNKNOWN';

export interface PhysicsConfig {
  enableDewarping: boolean;
  enableIntrinsic: boolean;
  enableDiffVG: boolean;
  enableMaterial: boolean;
}

// --- PDSR ARCHITECTURE TYPES ---

export interface GlobalPhysics {
  paperWhitePoint: string;       // Hex color of the substrate
  noiseProfile: 'CLEAN' | 'GAUSSIAN' | 'SALT_PEPPER' | 'PAPER_GRAIN' | 'JPEG_ARTIFACTS';
  blurKernel: 'NONE' | 'MOTION' | 'DEFOCUS' | 'LENS_SOFTNESS';
  lightingCondition: 'FLAT' | 'UNEVEN' | 'GLARE' | 'LOW_LIGHT';
}

export interface AtlasRegion {
  id: string;
  bbox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  content: string;
  semanticType: 'TEXT_INK' | 'STAMP_PIGMENT' | 'SIGNATURE_INK' | 'PHOTO_HALFTONE' | 'BACKGROUND_STAIN';
  textPrior?: string; // The "Ideal" text content
  restorationStrategy: 'SHARPEN_EDGES' | 'PRESERVE_COLOR' | 'DENOISE_ONLY' | 'DESCREEN';
  confidence: number;
}

export interface SemanticAtlas {
  globalPhysics: GlobalPhysics;
  regions: AtlasRegion[];
  degradationScore: number;
}

// --- CONSISTENCY LOOP TYPES ---

export interface ValidationResult {
  regionId: string;
  status: 'PASS' | 'FAIL';
  reason: string;
  confidence: number;
}

export interface ValidationReport {
  isConsistent: boolean;
  results: ValidationResult[];
  globalCritique: string;
}

// --- APP STATE ---

export interface PDSRConfig {
    enableTextPriors: boolean;
    enableTextureTransfer: boolean;
    enableSemanticRepair: boolean;
}

export interface RestorationConfig {
  imageType: ImageType;
  customPrompt: string;
  resolution: Resolution;
  aspectRatio: AspectRatio | string;
  colorStyle: ColorStyle;
  detailEnhancement: 'OFF' | 'BALANCED' | 'MAX';
  brushSize: number;
  maskBlendMode: MaskBlendMode;
  vectorDetail: 'LOW' | 'MEDIUM' | 'HIGH';
  vectorColor: 'BLACK_WHITE' | 'COLOR';
  pdsr: PDSRConfig;
  physics: PhysicsConfig;
}

export interface AnalysisResult {
  issues: string[];
  suggestedFixes: string[];
  rawAnalysis: string;
  description: string;
  detectedType: ImageType;
  dominantColors: string[];
  requiresDescreening: boolean;
  detectedWatermarks: string[];
  detectedInk?: InkType;
  detectedPaper?: PaperType;
}

export interface ProcessingState {
  isProcessing: boolean;
  stage: 'idle' | 'perception' | 'atlas_building' | 'restoring' | 'judging' | 'refining' | 'complete' | 'error';
  error: string | null;
  progressMessage: string;
  // NEW: Visualization properties
  progress: number; // 0 to 100
  networkStatus?: 'IDLE' | 'UPLOADING' | 'WAITING' | 'RECEIVING';
  latencyMs?: number;
}

export enum AgentStatus {
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
  NO_OP = 'NO_OP'
}

export interface AgentResponse<T> {
  status: AgentStatus;
  data: T | null;
  message: string;
}
