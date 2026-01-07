
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AgentResponse, AgentStatus, SemanticAtlas, GlobalPhysics, AtlasRegion } from "../types";
import { cleanRawJson, GEMINI_CONFIG, executeSafe, getClient, extractResponseText, downscaleImage } from "./geminiService";

// --- UTILITIES ---
const withRetry = async <T>(operation: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
    try {
        return await operation();
    } catch (error: any) {
        const code = error.status || error.code;
        if ((code === 503 || code === 429) && retries > 0) {
            console.warn(`[PerceptionService] Error ${code}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, delay * 2);
        }
        if (code === 500 && retries > 0) {
             console.warn(`[PerceptionService] Error 500 (Internal). Retrying once...`);
             await new Promise(resolve => setTimeout(resolve, delay));
             return withRetry(operation, retries - 1, delay * 2);
        }
        throw error;
    }
};

/**
 * MODULE A: COGNITIVE PERCEPTION ENGINE (The "Brain")
 * Task: Build the Semantic Atlas.
 * "Read" the image physics and content before touching pixels.
 */
export const buildSemanticAtlas = async (base64Image: string, mimeType: string): Promise<AgentResponse<SemanticAtlas>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.LOGIC_MODEL; 
    
    // Downscale for perception analysis to avoid token limits
    const optimizedBase64 = await downscaleImage(base64Image, mimeType, 1024);

    const prompt = `
    ACT AS A COMPUTER VISION "DEGRADATION ASSESSMENT NETWORK" (DAN) - VANGUARD EDITION (2026).
    TASK: Construct a Semantic Atlas of this image for Physics-Based Restoration (PDSR).
    
    <THINKING_PROCESS>
    1. **Physics Analysis (The Substrate)**:
       - GEOMETRIC ANALYSIS: Detect page curl/warp vectors using *DocTr++* logic.
       - MATERIAL ANALYSIS: Calculate Albedo (Paper White Point) vs Shading (Shape-from-Shading).
       - Sample the paper margins. Determine the RGB "White Point".
       - Analyze grain. Is it coarse (ISO Noise) or smooth (Compression artifacts)?
       - Estimate the Blur Kernel (Motion vs Defocus).
    
    2. **Semantic Segmentation & Priors**:
       - Identify Text Regions. READ the text. This string is the "contentPrior".
       - Identify Stains/Folds. Mark them as "BACKGROUND_STAIN".
       - Identify Stamps/Signatures. Mark as "STAMP_PIGMENT".
    </THINKING_PROCESS>
    
    OUTPUT: Strict JSON matching the SemanticAtlas structure.
    `;

    const schemaConfig = {
        type: Type.OBJECT,
        properties: {
            globalPhysics: {
                type: Type.OBJECT,
                properties: {
                    paperWhitePoint: { type: Type.STRING },
                    noiseProfile: { type: Type.STRING, enum: ['CLEAN', 'GAUSSIAN', 'SALT_PEPPER', 'PAPER_GRAIN', 'JPEG_ARTIFACTS'] },
                    blurKernel: { type: Type.STRING, enum: ['NONE', 'MOTION', 'DEFOCUS', 'LENS_SOFTNESS'] },
                    lightingCondition: { type: Type.STRING, enum: ['FLAT', 'UNEVEN', 'GLARE', 'LOW_LIGHT'] }
                }
            },
            degradationScore: { type: Type.NUMBER },
            regions: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        bbox: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                        content: { type: Type.STRING },
                        semanticType: { type: Type.STRING, enum: ['TEXT_INK', 'STAMP_PIGMENT', 'SIGNATURE_INK', 'PHOTO_HALFTONE', 'BACKGROUND_STAIN'] },
                        textPrior: { type: Type.STRING },
                        restorationStrategy: { type: Type.STRING, enum: ['SHARPEN_EDGES', 'PRESERVE_COLOR', 'DENOISE_ONLY', 'DESCREEN'] },
                        confidence: { type: Type.NUMBER }
                    }
                }
            }
        }
    };

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: optimizedBase64 } }, { text: prompt }] },
                config: {
                    responseMimeType: "application/json",
                    maxOutputTokens: GEMINI_CONFIG.MAX_OUTPUT_TOKENS, 
                    thinkingConfig: { thinkingBudget: GEMINI_CONFIG.THINKING_BUDGET }, 
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION,
                    responseSchema: schemaConfig
                }
            });
        });

        const json = cleanRawJson(extractResponseText(response) || "{}");
        const atlas = JSON.parse(json) as SemanticAtlas;
        if (!atlas.globalPhysics) throw new Error("Invalid Atlas Structure");

        return { status: AgentStatus.SUCCESS, data: atlas, message: "Semantic Atlas Built." };

    } catch (e: any) {
        console.error("Perception Engine Failed:", e);
        const fallbackAtlas: SemanticAtlas = {
            globalPhysics: { paperWhitePoint: '#FFFFFF', noiseProfile: 'CLEAN', blurKernel: 'NONE', lightingCondition: 'FLAT' },
            regions: [],
            degradationScore: 0
        };
        return { 
            status: AgentStatus.SUCCESS, 
            data: fallbackAtlas, 
            message: "Semantic Atlas Built (Fallback)." 
        };
    }
};
