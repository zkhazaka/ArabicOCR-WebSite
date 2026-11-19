
/**
 * AI Service for Arabic OCR
 * Handles interaction with OpenAI via the proxy_openai.php backend.
 */

const SYSTEM_PROMPT = `Role: You are a professional Document Restoration and Formatting Expert.

Task: Take the following raw OCR text and reconstruct it into a perfectly formatted document.

Strict Constraints:

No Summarization: Do not omit any information. Do not shorten sentences.

Dictation Correction: Fix obvious OCR typos, character misinterpretations, and spelling errors (especially common in Arabic script recognition).

Spatial Awareness: > * Reconstruct the original flow of lines and paragraphs.

Use bold for titles and headers.

Use bullet points or numbered lists where the text implies a sequence or list.

Table Reconstruction: If the OCR text contains fragmented data that looks like it belongs in a table, recreate it using Markdown table format. Ensure columns align logically.

Multi-language/Arabic Support: > * Maintain the integrity of Arabic grammar and script.

Ensure correct punctuation placement for RTL (Right-to-Left) text.

If the document is bilingual (e.g., Arabic/English), keep the translations in their respective order.

Clean Up: Remove artifacts like random characters (e.g., "|", "_", "©","*") or page numbers that interrupt the flow of a sentence.

Do not use markdown bold syntax (like **) for titles. Use clear spacing and capitalization instead.`;

export async function reconstructDocument(ocrText) {
    if (!ocrText || ocrText.trim().length === 0) {
        return null;
    }

    const prompt = SYSTEM_PROMPT + "\n\nOCR Result Restoration: " + ocrText;
    const dummyImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    try {
        const response = await fetch('gemini_ocr.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Image: dummyImage, prompt: prompt })
        });

        const result = await response.json();
        if (result.error) {
            console.error("AI Service Error from API:", result.error);
            return null;
        }
        if (result.candidates && result.candidates[0] && result.candidates[0].content) {
            let content = result.candidates[0].content.parts[0].text;
            content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            return content || null;
        }
        return null;

    } catch (error) {
        console.error("AI Service Exception:", error);
        return null;
    }
}
