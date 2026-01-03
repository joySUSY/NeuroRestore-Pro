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
        // Retry on Server Errors (5xx) or Rate Limits (429)
        if ((code === 503 || code === 429) && retries > 0) {
            console.warn(`[PerceptionService] Error ${code}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, delay * 2);
        }
        // If 500, it might be the model crashing on specific config (like Thinking), so we might want to fail fast to trigger fallback
        if (code === 500 && retries > 0) {
             console.warn(`[PerceptionService] Error 500 (Internal). Retrying once...`);
             await new Promise(resolve => setTimeout(resolve, delay));
             return withRetry(operation, retries - 1, delay * 2);
        }
        throw error;
    }
};

/**
 * MODULE A: COGNITIVE PERCEPTION ENGINE
 * Task: Build the Semantic Atlas.
 * "Read" the image physics and content before touching pixels.
 */
export const buildSemanticAtlas = async (base64Image: string, mimeType: string): Promise<AgentResponse<SemanticAtlas>> => {
    const ai = getClient();
    const model = "gemini-3-pro-preview"; 

    const prompt = `
    ACT AS A COMPUTER VISION "BIONIC EYE".
    TASK: Construct a Semantic Atlas of this image for restoration purposes.
    
    1. **Global Physics Estimation**:
       - Scan the "silent" areas (margins/background) to find the 'paperWhitePoint' (Hex color).
       - Determine the 'noiseProfile' (Is it clean, grainy, or compressed?).
       - Estimate the 'blurKernel' (Motion blur? Lens softness?).
    
    2. **Semantic Segmentation (Regions)**:
       - Identify critical regions: Text Blocks, Stamps, Signatures, Photos, Stains.
       - For Text: Extract the content (OCR) to serve as a "Text Prior".
       - For Stains/Damage: Mark them as 'BACKGROUND_STAIN' for removal.
       - For Stamps/Signatures: Mark them to 'PRESERVE_COLOR'.
    
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
        // We use a lower thinking budget to avoid timeouts, but if it still 500s, we catch and fallback.
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                maxOutputTokens: 20000,
                thinkingConfig: { thinkingBudget: 4096 }, // Conservative thinking budget
                responseSchema: schemaConfig
            }
        }), 1); // Retry once

        const json = cleanRawJson(response.text || "{}");
        const atlas = JSON.parse(json) as SemanticAtlas;
        if (!atlas.globalPhysics) throw new Error("Invalid Atlas Structure");

        return { status: AgentStatus.SUCCESS, data: atlas, message: "Semantic Atlas Built (Deep Mode)." };

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
                    // Disabled Thinking Config
                    responseSchema: schemaConfig
                }
            }), 2); // More retries for standard mode

            const json = cleanRawJson(response.text || "{}");
            const atlas = JSON.parse(json) as SemanticAtlas;
            
            // Defaulting if parsing partially failed
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
