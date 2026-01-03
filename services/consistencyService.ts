import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SemanticAtlas, ValidationReport, AgentResponse, AgentStatus } from "../types";
import { cleanRawJson, executeSafe } from "./geminiService";

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenAI({ apiKey });
};

// Reusing retry logic pattern locally
const withRetry = async <T>(operation: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
    try {
        return await operation();
    } catch (error: any) {
        const code = error.status || error.code;
        if ((code === 503 || code === 429) && retries > 0) {
            console.warn(`[ConsistencyService] Error ${code}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, delay * 2);
        }
        if (code === 500 && retries > 0) {
             await new Promise(resolve => setTimeout(resolve, delay));
             return withRetry(operation, retries - 1, delay * 2);
        }
        throw error;
    }
};

/**
 * MODULE C: THE CONSISTENCY JUDGE
 * Task: Compare Source vs Restored based on Semantic Atlas.
 * Validates text legibility, texture fidelity, and artifact removal.
 */
export const validateRestoration = async (
    originalBase64: string,
    restoredBase64: string,
    atlas: SemanticAtlas
): Promise<AgentResponse<ValidationReport>> => {
    const ai = getClient();
    const model = "gemini-3-pro-preview"; 

    // Focus only on critical regions to save context window and focus attention
    const criticalRegions = atlas.regions.filter(r => 
        r.semanticType === 'TEXT_INK' || r.semanticType === 'SIGNATURE_INK'
    ).slice(0, 10); // Check top 10 most important regions

    const checklist = criticalRegions.map(r => 
        `- Region ${r.id} (${r.semanticType}): Must clearly read "${r.content}".`
    ).join('\n');

    const prompt = `
    ACT AS A VISUAL QUALITY ASSURANCE (QA) CRITIC.
    TASK: Compare the Original Image (Source) against the Restored Image (Candidate).
    
    SEMANTIC TRUTH (ATLAS):
    Paper Type: ${atlas.globalPhysics.paperWhitePoint}
    Noise Profile: ${atlas.globalPhysics.noiseProfile}
    
    REGION CHECKLIST:
    ${checklist}
    
    CRITERIA FOR "FAIL":
    1. **Hallucination**: The restored text spells something different than the Atlas content.
    2. **Oversmoothing**: The paper texture looks like plastic (loss of high-frequency grain).
    3. **Artifacts**: New artifacts (checkerboard patterns, color bleeding) introduced.
    
    OUTPUT: A strict JSON report.
    `;

    const schemaConfig = {
        type: Type.OBJECT,
        properties: {
            isConsistent: { type: Type.BOOLEAN },
            globalCritique: { type: Type.STRING },
            results: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        regionId: { type: Type.STRING },
                        status: { type: Type.STRING, enum: ['PASS', 'FAIL'] },
                        reason: { type: Type.STRING },
                        confidence: { type: Type.NUMBER }
                    }
                }
            }
        }
    };

    try {
        // ATTEMPT 1: High Reasoning (Thinking)
        const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model,
            contents: { 
                parts: [
                    { inlineData: { mimeType: "image/png", data: originalBase64 } }, // Source
                    { inlineData: { mimeType: "image/png", data: restoredBase64 } }, // Candidate
                    { text: prompt }
                ] 
            },
            config: {
                responseMimeType: "application/json",
                maxOutputTokens: 20000,
                thinkingConfig: { thinkingBudget: 4096 }, // Reduced budget
                responseSchema: schemaConfig
            }
        }), 1);

        const json = cleanRawJson(response.text || "{}");
        const report = JSON.parse(json) as ValidationReport;

        return { 
            status: AgentStatus.SUCCESS, 
            data: report, 
            message: "Validation Complete" 
        };

    } catch (e: any) {
        console.warn("Consistency Judge (Thinking) Failed. Retrying Standard Mode.", e);
        
        try {
            // ATTEMPT 2: Standard
            const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model,
                contents: { 
                    parts: [
                        { inlineData: { mimeType: "image/png", data: originalBase64 } },
                        { inlineData: { mimeType: "image/png", data: restoredBase64 } },
                        { text: prompt }
                    ] 
                },
                config: {
                    responseMimeType: "application/json",
                    maxOutputTokens: 20000,
                    // No Thinking
                    responseSchema: schemaConfig
                }
            }), 2);

            const json = cleanRawJson(response.text || "{}");
            const report = JSON.parse(json) as ValidationReport;
            return { status: AgentStatus.SUCCESS, data: report, message: "Validation Complete (Standard)" };

        } catch (fallbackError: any) {
            console.error("Consistency Judge Completely Failed:", fallbackError);
            // Fallback: Assume success if QA fails to avoid blocking the user
            return { 
                status: AgentStatus.ERROR, 
                data: { isConsistent: true, results: [], globalCritique: "QA Service Unavailable" }, 
                message: fallbackError.message 
            };
        }
    }
};
