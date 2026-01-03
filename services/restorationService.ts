import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AgentResponse, AgentStatus, SemanticAtlas, RestorationConfig, AspectRatio } from "../types";
import { executeSafe } from "./geminiService";

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
        if ((code === 500 || code === 503 || code === 429) && retries > 0) {
            console.warn(`[RestorationService] Error ${code}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, delay * 2);
        }
        throw error;
    }
};

const getClosestAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    const supported = [
        { val: "1:1", ratio: 1.0 }, { val: "3:4", ratio: 0.75 }, { val: "4:3", ratio: 1.333 }, 
        { val: "9:16", ratio: 0.5625 }, { val: "16:9", ratio: 1.7778 },
        { val: "2:3", ratio: 0.666 }, { val: "3:2", ratio: 1.5 },
        { val: "4:5", ratio: 0.8 }, { val: "5:4", ratio: 1.25 },
        { val: "21:9", ratio: 2.333 }
    ];
    return supported.reduce((prev, curr) => 
        Math.abs(curr.ratio - ratio) < Math.abs(prev.ratio - ratio) ? curr : prev
    ).val;
};

/**
 * MODULE B: FEATURE-INJECTION RESTORATION ENGINE
 * Task: Execute PDSR (Perception-Driven Semantic Restoration).
 * Uses the Atlas to guide pixel hallucination.
 */
export const renderPDSR = async (
    base64Image: string, 
    mimeType: string, 
    width: number, 
    height: number,
    atlas: SemanticAtlas,
    config: RestorationConfig
): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview"; 

    const targetAspectRatio = config.aspectRatio === AspectRatio.ORIGINAL 
        ? getClosestAspectRatio(width, height) 
        : config.aspectRatio;

    // 1. Construct Control Signal from Atlas
    const textRegions = atlas.regions.filter(r => r.semanticType === 'TEXT_INK');
    const stampRegions = atlas.regions.filter(r => r.semanticType === 'STAMP_PIGMENT');
    const stainRegions = atlas.regions.filter(r => r.semanticType === 'BACKGROUND_STAIN');

    let textPriors = "";
    if (config.pdsr.enableTextPriors && textRegions.length > 0) {
        textPriors = `
        *** TEXT-PRIOR GUIDANCE (TPSR) ***
        Inject the following semantic content into the super-resolution features.
        Ensure these strings are rendered with vector-sharp edges:
        ${textRegions.slice(0, 15).map(r => `- "${r.content}" (Strategy: ${r.restorationStrategy})`).join('\n')}
        ... and all other detected text.
        `;
    }

    let colorAnchors = "";
    if (stampRegions.length > 0) {
        colorAnchors = `
        *** ADAPTIVE COLOR ANCHORING ***
        For Stamp/Signature regions, PRESERVE intrinsic pigment.
        Do not binarize or grayscale these areas. Keep the authentic ink flow.
        `;
    }

    let repairDirectives = "";
    if (config.pdsr.enableSemanticRepair && stainRegions.length > 0) {
        repairDirectives = `
        *** SEMANTIC REPAIR ***
        Detected ${stainRegions.length} regions of damage/stains.
        INSTRUCTION: Inpaint these regions using the surrounding paper texture defined below.
        `;
    }

    const texturePrompt = config.pdsr.enableTextureTransfer 
        ? `*** NEURAL TEXTURE TRANSFER (NTT) ***
           Reference Physics:
           - Substrate Color: ${atlas.globalPhysics.paperWhitePoint}
           - Noise Profile: ${atlas.globalPhysics.noiseProfile}
           INSTRUCTION: Synthesize high-frequency details that match this specific paper grain. 
           Reject synthetic "plastic" smoothing. Maintain the material fidelity.`
        : "";

    const finalPrompt = `
    ROLE: Perception-Driven Restoration Engine (PDSR).
    TASK: Perform Deep Restoration on this image using the provided Semantic Atlas.
    
    INPUT CONTEXT:
    - Degradation Score: ${atlas.degradationScore}/100
    - Blur Kernel: ${atlas.globalPhysics.blurKernel}
    
    RESTORATION PROTOCOLS:
    ${textPriors}
    ${colorAnchors}
    ${repairDirectives}
    ${texturePrompt}
    
    VISUAL OUTPUT STANDARDS:
    1. **Deep Clarity**: Remove the detected '${atlas.globalPhysics.blurKernel}' blur.
    2. **Material Truth**: The output must look like the original physical document, not a digital recreation.
    3. **Resolution**: 4K High-Bitrate output.
    
    USER OVERRIDE: ${config.customPrompt}
    `;

    try {
        // executeSafe wrapper handles network concurrency
        // NOTE: gemini-3-pro-image-preview does NOT support thinkingConfig, so we do not pass it.
        const response = await executeSafe<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: finalPrompt }] },
            config: {
                imageConfig: { 
                    imageSize: "4K",
                    aspectRatio: targetAspectRatio as any
                }
            }
        }));

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return { 
                    status: AgentStatus.SUCCESS, 
                    data: `data:image/png;base64,${part.inlineData.data}`, 
                    message: "Restoration Complete" 
                };
            }
        }
        return { status: AgentStatus.ERROR, data: null, message: "No image generated" };

    } catch (e: any) {
        console.error("Restoration Engine Failed:", e);
        // Clean error message for UI
        const msg = e.message || "Unknown restoration error";
        return { status: AgentStatus.ERROR, data: null, message: msg };
    }
};

/**
 * SURGICAL REFINEMENT
 * Task: Correct a specific region that failed validation.
 */
export const refineRegion = async (
    regionBase64: string,
    failureReason: string,
    semanticContext: string
): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview"; 

    const prompt = `
    ROLE: Surgical Image Correction Agent.
    TASK: Fix a specific artifact in this image patch.
    
    CONTEXT:
    This is a crop from a larger document.
    Semantic Content: "${semanticContext}"
    
    FAILURE DIAGNOSIS:
    "${failureReason}"
    
    INSTRUCTION:
    Re-generate this specific patch to resolve the failure.
    - If "Hallucination": Force the text to read EXACTLY "${semanticContext}".
    - If "Oversmoothing": Add noise/grain to match paper texture.
    - Maintain seamless edges (do not change lighting at borders).
    
    OUTPUT: The corrected image patch.
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType: "image/png", data: regionBase64 } }, { text: prompt }] },
            config: {
                imageConfig: { 
                    imageSize: "1K", // Smaller resolution for patches
                    aspectRatio: "1:1"
                }
            }
        }));

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return { 
                    status: AgentStatus.SUCCESS, 
                    data: `data:image/png;base64,${part.inlineData.data}`, 
                    message: "Refinement Complete" 
                };
            }
        }
        return { status: AgentStatus.ERROR, data: null, message: "Refinement failed" };
    } catch (e: any) {
        return { status: AgentStatus.ERROR, data: null, message: e.message };
    }
};