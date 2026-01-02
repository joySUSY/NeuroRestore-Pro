import { GoogleGenAI } from "@google/genai";

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenAI({ apiKey });
};

/**
 * ALGORITHM 1: 3D GEOMETRIC DEWARPING (DocTr Simulation)
 * Uses mesh-based reasoning to flatten curved documents.
 */
export const geometricUnwarp = async (base64Image: string, mimeType: string): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview";

    const prompt = `
    ACT AS A GEOMETRIC RECTIFICATION ENGINE (DocTr).
    
    INPUT: A distorted, warped, or curled document image.
    TASK: Perform 3D Mesh Unrolling to flatten the document into a perfect 2D plane.
    
    ALGORITHMIC STEPS:
    1. **Mesh Prediction:** Estimate the 3D surface flow of the paper. Detect Z-axis curvature.
    2. **Unrolling:** Mathematically "unroll" the mesh to flatten page curls.
    3. **Perspective Correction:** Rectify the camera angle to a top-down orthogonal view (Flatbed Scanner View).
    4. **Resampling:** Map original pixels to the new rectified coordinates.

    CONSTRAINTS:
    - DO NOT change the content, text, or font.
    - DO NOT perform color correction yet.
    - OUTPUT: The raw, flattened image data.
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                imageConfig: { imageSize: "2K", aspectRatio: "ORIGINAL" } // Keep original ratio but rectified
            }
        });
        
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
        return `data:${mimeType};base64,${base64Image}`; // Fallback
    } catch (e) {
        console.warn("Dewarping failed, proceeding with original.", e);
        return `data:${mimeType};base64,${base64Image}`;
    }
};

/**
 * ALGORITHM 2: INTRINSIC IMAGE DECOMPOSITION (PIDNet Simulation)
 * Separates Reflectance (Albedo) from Shading to remove shadows/lighting.
 */
export const intrinsicDecomposition = async (base64Image: string, mimeType: string): Promise<string> => {
    const ai = getClient();
    const model = "gemini-3-pro-image-preview";

    const prompt = `
    ACT AS A PHYSICS-BASED RENDERING ENGINE.
    TASK: Perform Intrinsic Image Decomposition.
    
    THEORY:
    Image (I) = Reflectance (R) * Shading (S).
    
    INSTRUCTION:
    1. **Decompose** the input image into Reflectance (Albedo) and Shading maps.
    2. **Discard** the Shading map (S). This removes all shadows, uneven lighting, scanner glare, and paper crease shadows.
    3. **Output** ONLY the Reflectance map (R).
    
    VISUAL GOAL:
    - The output should look like the raw material color (Flat Albedo).
    - Text should be pure ink color (e.g. #000000) on pure paper color (e.g. #FFFFFF).
    - No lighting gradients. No shadows.
    `;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ inlineData: { mimeType, data: base64Image } }, { text: prompt }] },
            config: {
                imageConfig: { imageSize: "2K", aspectRatio: "ORIGINAL" }
            }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
        return `data:${mimeType};base64,${base64Image}`;
    } catch (e) {
        console.warn("Intrinsic decomposition failed, proceeding with original.", e);
        return `data:${mimeType};base64,${base64Image}`;
    }
};
