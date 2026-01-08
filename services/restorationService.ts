
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AgentResponse, AgentStatus, SemanticAtlas, RestorationConfig, AspectRatio } from "../types";
import { executeSafe, GEMINI_CONFIG } from "./geminiService";

// --- CONFIGURATION ---
const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenAI({ apiKey });
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
 * MODULE B: FEATURE-INJECTION RESTORATION ENGINE (The "Hand")
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
    const model = GEMINI_CONFIG.VISION_MODEL;

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
        *** TPGSR (Text-Prior Guided Super-Resolution) ACTIVATED ***
        INJECT the following Semantic Ground Truth into the generation features.
        The output MUST contain these exact strings in high-definition typography:
        ${textRegions.slice(0, 20).map(r => `- "${r.content}"`).join('\n')}
        ... and ensure all other text is vector-sharp.
        `;
    }

    let colorAnchors = "";
    if (stampRegions.length > 0) {
        colorAnchors = `
        *** CHROMATICITY FREEZE ***
        For Stamp/Signature regions, LOCK the pigment values.
        Do not binarize. Maintain the analog variability of the ink.
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
           Target Physics:
           - Substrate: ${atlas.globalPhysics.paperWhitePoint}
           - Noise: ${atlas.globalPhysics.noiseProfile}
           INSTRUCTION: Re-synthesize high-frequency grain. Reject "plastic" smoothing.`
        : "";

    const finalPrompt = `
    ROLE: Perception-Driven Semantic Restoration Engine (PDSR) - Vanguard V3.
    TASK: Perform Deep Restoration on this image using the provided Semantic Atlas.
    
    INPUT CONTEXT (The Semantic Atlas):
    - Degradation Score: ${atlas.degradationScore}/100
    - Blur Kernel: ${atlas.globalPhysics.blurKernel}
    
    CORE OBJECTIVES:
    1. **DEBLUR**: Remove '${atlas.globalPhysics.blurKernel}' blur.
    2. **DENOISE**: Remove JPEG artifacts but KEEP paper grain.
    3. **UPSAMPLE**: 4K High-Bitrate output.
    
    ${textPriors}
    ${colorAnchors}
    ${repairDirectives}
    ${texturePrompt}
    
    USER OVERRIDE: ${config.customPrompt}
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: finalPrompt }] },
                config: {
                    imageConfig: { 
                        imageSize: "4K",
                        aspectRatio: targetAspectRatio as any
                    },
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        }, 'CRITICAL');

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
        const msg = e.message || "Unknown restoration error";
        return { status: AgentStatus.ERROR, data: null, message: msg };
    }
};

/**
 * SURGICAL REFINEMENT
 * Task: Correct a specific region that failed validation.
 * Uses ADAPTIVE RE-PROMPTING based on the failure diagnosis.
 */
export const refineRegion = async (
    regionBase64: string,
    failureReason: string,
    semanticContext: string,
    semanticType: string = 'TEXT_INK'
): Promise<AgentResponse<string>> => {
    const ai = getClient();
    const model = GEMINI_CONFIG.VISION_MODEL;

    // --- ADAPTIVE RE-PROMPTING STRATEGY ---
    let strategy = "";
    const lowerReason = failureReason.toLowerCase();

    if (lowerReason.includes("ocr") || lowerReason.includes("text") || lowerReason.includes("read") || lowerReason.includes("illegible")) {
        strategy = `
        **DIAGNOSIS:** Text is illegible or incorrect (OCR Mismatch).
        **SURGICAL ACTION:** FORCE_TYPOGRAPHY_RECONSTRUCTION.
        - You MUST render the string: "${semanticContext}" clearly.
        - Increase contrast. Sharpen edges. Use a dark ink color.
        `;
    } else if (lowerReason.includes("texture") || lowerReason.includes("smooth") || lowerReason.includes("plastic")) {
        strategy = `
        **DIAGNOSIS:** Texture Mismatch (Plasticity).
        **SURGICAL ACTION:** GRAIN_INJECTION.
        - Add monochromatic Gaussian noise to match the surrounding paper.
        - Do not blur. Keep it crisp.
        `;
    } else if (lowerReason.includes("hallucination") || lowerReason.includes("artifact")) {
        strategy = `
        **DIAGNOSIS:** Hallucination / Artifacts.
        **SURGICAL ACTION:** ARTIFACT_REMOVAL.
        - Clean the background.
        - Re-draw the content "${semanticContext}" simply and cleanly.
        `;
    } else {
        strategy = `
        **DIAGNOSIS:** General Quality Failure.
        **SURGICAL ACTION:** ENHANCE_FIDELITY.
        - Sharpen text: "${semanticContext}".
        - Clean background.
        `;
    }

    const prompt = `
    ROLE: Surgical Image Correction Agent.
    TASK: Repair this specific image patch based on the diagnosis.
    
    SEMANTIC TRUTH: "${semanticContext}"
    TYPE: ${semanticType}
    
    ${strategy}
    
    IMPORTANT: Return ONLY the corrected image patch. Maintain the same aspect ratio and lighting as the input.
    `;

    try {
        const response = await executeSafe<GenerateContentResponse>(async () => {
            return ai.models.generateContent({
                model,
                contents: { parts: [{ inlineData: { mimeType: "image/png", data: regionBase64 } }, { text: prompt }] },
                config: {
                    imageConfig: { imageSize: "1K", aspectRatio: "1:1" }, // Square patch
                    systemInstruction: GEMINI_CONFIG.SYSTEM_INSTRUCTION
                }
            });
        }, 'CRITICAL');

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
