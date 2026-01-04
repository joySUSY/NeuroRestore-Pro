
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AgentResponse, AgentStatus, SemanticAtlas, GlobalPhysics, AtlasRegion } from "../types";
import { cleanRawJson } from "./geminiService";

// --- CONFIGURATION ---
const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenAI({ apiKey });
};

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
    const model = "gemini-3-pro-preview"; 

    const prompt = `
    ACT AS A COMPUTER VISION "DEGRADATION ASSESSMENT NETWORK" (DAN).
    TASK: Construct a Semantic Atlas of this image for Physics-Based Restoration (PDSR).
    
    <THINKING_PROCESS>
    1. **Physics Analysis (The Substrate)**:
       - Sample the paper margins. Determine the RGB "White Point" (e.g., #F0F0E0).
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
        // ATTEMPT 1: High Intelligence (Thinking Enabled)
        // Using 16k tokens - deep reasoning but safe from extreme timeouts
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                maxOutputTokens: 20000, 
                thinkingConfig: { thinkingBudget: 16384 }, // High Intelligence
                responseSchema: schemaConfig
            }
        }), 1); 

        const json = cleanRawJson(response.text || "{}");
        const atlas = JSON.parse(json) as SemanticAtlas;
        if (!atlas.globalPhysics) throw new Error("Invalid Atlas Structure");

        return { status: AgentStatus.SUCCESS, data: atlas, message: "Semantic Atlas Built." };

    } catch (e: any) {
        console.warn("Perception (Deep Mode) failed. Falling back to Standard Mode.", e);

        // ATTEMPT 2: Standard Mode (No Thinking, Higher Robustness)
        try {
            const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
                config: {
                    responseMimeType: "application/json",
                    maxOutputTokens: 20000,
                    // Disabled Thinking Config for fallback robustness
                    responseSchema: schemaConfig
                }
            }), 2);

            const json = cleanRawJson(response.text || "{}");
            const atlas = JSON.parse(json) as SemanticAtlas;
            
            if (!atlas.globalPhysics) {
                atlas.globalPhysics = { paperWhitePoint: '#FFFFFF', noiseProfile: 'CLEAN', blurKernel: 'NONE', lightingCondition: 'FLAT' };
            }
            if (!atlas.regions) atlas.regions = [];

            return { status: AgentStatus.SUCCESS, data: atlas, message: "Semantic Atlas Built (Standard Mode)." };

        } catch (fallbackError: any) {
            console.error("Perception Engine Completely Failed:", fallbackError);
            return { 
                status: AgentStatus.ERROR, 
                data: null, 
                message: fallbackError.message || "Failed to build Semantic Atlas." 
            };
        }
    }
};
