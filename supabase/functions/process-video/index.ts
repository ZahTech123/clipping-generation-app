// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CORS Configuration ( 그대로 유지 ) ---
const VERCEL_PREVIEW_URL = 'https://clipping-generation-app-1far-cp7r9udye-zahtech123s-projects.vercel.app';
const VERCEL_PRODUCTION_URL = 'https://clipping-generation-app-1far.vercel.app';
const LOCALHOST_URL = 'http://localhost:5173';

const allowedOrigins = [
  VERCEL_PREVIEW_URL,
  VERCEL_PRODUCTION_URL,
  LOCALHOST_URL,
];

function getDynamicCorsHeaders(requestOrigin: string | null): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  } else {
    console.warn(`CORS (process-video): Request from origin "${requestOrigin}" is not in the allowed list.`);
  }
  return headers;
}
// --- End CORS Configuration ---


// --- Gemini API Safety Settings and Generation Configuration ( 그대로 유지 ) ---
const safetySettings = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
];

const generationConfig = {
  temperature: 0.4,
  topK: 32,
  topP: 1,
  maxOutputTokens: 8192,
};

// --- List of Video Themes (To be included in the prompt) ---
const VIDEO_THEMES_LIST_TEXT = `
Main Niches & Themes for YouTube Video Clipping:
1. Podcast Clipping (Examples: Joe Rogan Experience, Lex Fridman, Impaulsive; Purpose: Highlight best moments, debates, jokes, expert quotes; Styles: Vertical format, speaker zoom-ins, captions, animated waveforms)
2. Educational/Tutorial Clipping (Examples: TED Talks, Kurzgesagt, CrashCourse; Purpose: Break down complex content; Styles: Clean transitions, on-screen annotations, chapter-based titles)
3. Gaming Clipping (Examples: Fortnite, Minecraft, Warzone; Purpose: Showcase best plays, fails, reactions; Styles: Zooms, memes, background music, player cam overlays)
4. Motivational/Inspirational (Examples: David Goggins, Jordan Peterson, Gary Vee; Purpose: Share powerful quotes, success stories; Styles: B-roll overlay, epic music, subtitles, cinematic color grading)
5. Finance & Business Clipping (Examples: Shark Tank, Grant Cardone, CNBC; Purpose: Highlight investment advice, market trends; Styles: Data overlay, news style, bold text subtitles)
6. Tech Reviews & Tutorials (Examples: MKBHD, Linus Tech Tips; Purpose: Clip best reviews, comparisons; Styles: Product zoom-ins, comparison charts, B-roll with voiceover)
7. Fitness & Health (Examples: Workout routines, diet plans; Purpose: Inspire/educate with short clips; Styles: Before/after, high-energy music, rep counters)
8. Lifestyle & Vlogging (Examples: Travel vlogs, daily routines; Purpose: Capture funny moments, travel tips; Styles: Fast cuts, sound effects, emojis/text popups)
9. Drama & Commentary (Examples: YouTube beef, streamer drama; Purpose: Clip rants, callouts; Styles: Memes, zoom-in reactions, layered screenshots)
10. Interviews & Panel Discussions (Examples: News channels, documentaries; Purpose: Share key quotes, emotional stories; Styles: Interviewee focus, headline overlays, emotional BGM)
11. Comedy & Reaction Clips (Examples: Stand-up, pranks, reactions; Purpose: Capture laughs, epic reactions; Styles: Replays, slow motion, meme cuts, laugh track)
12. Music & Artist Clipping (Examples: Freestyles, live performances; Purpose: Highlight iconic lines, crowd reactions; Styles: Lyrical captions, cinematic cuts, waveform effects)
13. Movie & TV Commentary/Recaps (Examples: Film analysis, show highlights; Purpose: Share plot summaries, reactions; Styles: Scene cuts, voiceovers, cinematic transitions)
14. Sports & Highlights (Examples: NBA, UFC, Soccer; Purpose: Show goals, best plays; Styles: Score overlays, slow-mo, game stats, commentary replays)
15. News & Politics (Examples: Debate highlights, political commentary; Purpose: Highlight statements, shocking moments; Styles: On-screen quotes, news frames, fact-check popups)

Specialized Niches (Emerging or Niche Markets):
- Book Summary Clips – Quotes and key lessons from book reviews
- Crypto & NFTs – Market movements, influencer predictions
- Spiritual/Religious Content – Sermon snippets, quotes, parables
- Cooking/Food – Recipes in 30–60 second formats
- Kids & Education – Learning moments for children
- ASMR Clips – Sensory-focused shorts from longer ASMR sessions
`;
// --- End List of Video Themes ---

// --- <<< MODIFIED GEMINI PROMPT for Clips and Themes >>> ---
const MAX_SUGGESTED_CLIPS = 10;

const viralClippingAndThemePrompt = `
You are an expert viral video strategist and short-form content editor. Your goal is to analyze this video for two purposes:
1.  Identify segments with the highest potential to become highly engaging, shareable short clips.
2.  Determine the overall primary themes of the entire video.

Instructions for Clip Identification:
Prioritize segments that exhibit one or more of the following strong viral characteristics:
- Strong Hooks: The proposed clip itself should grab attention within its first 1-3 seconds.
- Emotional Peaks: Moments evoking strong, clear emotions.
- Curiosity Gaps / The Curiosity Loop: Segments that create intrigue.
- Surprising Elements / Contrast: Unexpected twists, reveals.
- Clear Value & Relatability: Offers concise entertainment, a valuable tip/insight.
- Visually Striking or Dynamic Sequences: Compelling visuals, rapid action.
- Powerful/Memorable Quotes or Statements: Concise, impactful lines.
- Narrative Completeness (Micro-Story): Mini-story with beginning, middle, end/cliffhanger.
- Pattern Interrupts: Moments that break an established pattern.

Avoid selecting segments that are primarily:
- Purely transitional footage.
- Prolonged silence without visual interest.
- Significantly poor audio quality.
- Overly confusing in isolation (unless intentional for curiosity).
- Mere setup without payoff within the clip.
- Overly long, static monologues without engagement.

Ensure each identified clip makes sense and delivers value or intrigue as a standalone piece.

Instructions for Overall Video Theme Identification:
Based on the entire video's content, subject matter, presentation style, and likely target audience, identify up to 3-5 of the most relevant primary themes from the 'Main Niches & Themes for YouTube Video Clipping' list provided below. If a video strongly fits into more than 5, you may list them, but focus on the most dominant ones.

Output Format:
Format your response as a single, valid JSON object. This JSON object MUST contain two top-level keys:
1.  "identifiedClips": An array of objects. Each object in this array represents a potential clip and MUST strictly follow the structure detailed below (Clip Object Structure points 1-8).
2.  "suggestedVideoThemes": An array of strings. Each string in this array must be one of the theme names exactly as listed in the 'Main Niches & Themes for YouTube Video Clipping' section provided.

Clip Object Structure (for each object within the "identifiedClips" array):
1.  "startTime" (integer, in seconds from the beginning of the video)
2.  "endTime" (integer, in seconds from the beginning of the video)
3.  "description" (concise, engaging summary, max 150 chars)
4.  "hookPhraseTitle" (most compelling spoken phrase/dialogue for title, max 150 chars. Use "N/A" if not applicable.)
5.  "clipTranscription" (transcript of spoken audio within the clip. If non-verbal with significant sounds, describe them. If no relevant audio, use "N/A".)
6.  "primaryViralCharacteristic" (single most dominant viral characteristic from the list above, e.g., "Emotional Peak - Humor")
7.  "viralPotentialScore" (integer 1-10, 10 is highest)
8.  "reasoningForScore" (brief, one-sentence explanation for score, max 200 chars, e.g., "Score 9: Relatable frustration and hilarious outcome make it shareable.")

General Output Rules:
- The entire response MUST be a single JSON object starting with '{' and ending with '}'.
- Do not include any introductory text, concluding text, comments, or markdown formatting like \`\`\`json or \`\`\` before or after the JSON object.
- For "identifiedClips": Ensure startTime is always less than endTime. Clip durations should ideally be 5-60 seconds, but prioritize impact (2-5s for strong hooks, 60-90s for complete micro-stories are acceptable). Aim for up to ${MAX_SUGGESTED_CLIPS} suggestions, prioritizing quality over quantity. If only 1-2 strong clips are found, provide only those.

---
Main Niches & Themes for YouTube Video Clipping (for "suggestedVideoThemes"):
${VIDEO_THEMES_LIST_TEXT} 
---

Now, analyze the video and provide your response in the specified JSON object format.
`;
// --- End MODIFIED GEMINI PROMPT ---


// --- Main Edge Function Handler ---
serve(async (req: Request) => {
  const requestOrigin = req.headers.get('Origin');
  const requestUrl = req.url;
  const functionName = "[PROCESS-VIDEO-V2]"; 
  console.log(`${functionName} Incoming ${req.method} request from Origin: ${requestOrigin} to URL: ${requestUrl}`);

  const responseCorsHeaders = getDynamicCorsHeaders(requestOrigin);

  if (req.method === 'OPTIONS') {
    console.log(`${functionName} Handling OPTIONS preflight request.`);
    if (responseCorsHeaders['Access-Control-Allow-Origin']) {
      return new Response(null, { headers: responseCorsHeaders, status: 204 });
    } else {
      const forbiddenPreflightHeaders = { ...responseCorsHeaders };
      delete forbiddenPreflightHeaders['Access-Control-Allow-Origin'];
      return new Response(null, { headers: forbiddenPreflightHeaders, status: 403 });
    }
  }

  if (!responseCorsHeaders['Access-Control-Allow-Origin']) {
      console.warn(`${functionName} Forbidden: Request from origin ${requestOrigin} is not allowed.`);
      return new Response(JSON.stringify({ error: 'Cross-Origin Request Blocked' }), {
          status: 403, headers: { 'Content-Type': 'application/json' }
      });
  }

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  const SUPABASE_URL_ENV = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!GEMINI_API_KEY || !SUPABASE_URL_ENV || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`${functionName} FATAL: Missing critical server environment variables!`);
    return new Response(JSON.stringify({ error: 'Server Configuration Error' }), {
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' }, status: 500
    });
  }

  const MODEL_NAME = "gemini-1.5-flash-latest";
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
  console.log(`${functionName} Using Gemini model:`, MODEL_NAME);

  if (req.method === 'POST') {
    try {
      const contentType = req.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn(`${functionName} Invalid content type:`, contentType);
        return new Response(JSON.stringify({ error: 'Invalid Request Header' }), {
          headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' }, status: 400
        });
      }

      const requestBody = await req.json();
      const { uploadedVideoPath, videoUrl } = requestBody;

      let videoUriForGemini: string;
      let processedVideoSourceType: 'supabase' | 'external_url';
      let originalPathOrUrl: string;

      // ... (Video URI obtaining logic - same as before)
      if (uploadedVideoPath && typeof uploadedVideoPath === 'string') {
         console.log(`${functionName} Processing Supabase uploaded video path:`, uploadedVideoPath);
         originalPathOrUrl = uploadedVideoPath;
         processedVideoSourceType = 'supabase';
         const supabaseAdminClient = createClient(SUPABASE_URL_ENV, SUPABASE_SERVICE_ROLE_KEY);
         const { data: publicUrlData } = supabaseAdminClient.storage.from('raw-videos').getPublicUrl(uploadedVideoPath);

         if (publicUrlData?.publicUrl && publicUrlData.publicUrl.includes(uploadedVideoPath)) {
           videoUriForGemini = publicUrlData.publicUrl;
         } else {
           const { data: signedUrlData, error: signedUrlError } = await supabaseAdminClient.storage
             .from('raw-videos').createSignedUrl(uploadedVideoPath, 3600); // 1 hour expiry
           if (signedUrlError || !signedUrlData?.signedUrl) {
             throw new Error(`Failed to create accessible URL for Supabase video: ${uploadedVideoPath}. ${signedUrlError?.message || ''}`);
           }
           videoUriForGemini = signedUrlData.signedUrl;
         }
         console.log(`${functionName} Using Supabase video URI (first 80 chars): ${videoUriForGemini.substring(0,80)}...`);
      } else if (videoUrl && typeof videoUrl === 'string') {
         console.log(`${functionName} Processing provided video URL:`, videoUrl);
         try { new URL(videoUrl); } catch (_) {
             return new Response(JSON.stringify({ error: 'Invalid Input', error_message: 'Invalid videoUrl format.' }), {
                 headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' }, status: 400
             });
         }
         videoUriForGemini = videoUrl;
         originalPathOrUrl = videoUrl;
         processedVideoSourceType = 'external_url';
         console.log(`${functionName} Using external URL for Gemini:`, videoUriForGemini);
      } else {
        return new Response(JSON.stringify({ error: 'Missing Input', error_message: '"uploadedVideoPath" or "videoUrl" required.' }), {
          headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' }, status: 400
        });
      }

      // ... (MIME type detection logic - same as before)
      let mimeType = "video/mp4"; // Default
      try {
        const pathPart = new URL(videoUriForGemini).pathname;
        const lowerPath = pathPart.toLowerCase();
        if (lowerPath.endsWith(".mov")) mimeType = "video/quicktime";
        else if (lowerPath.endsWith(".mpeg") || lowerPath.endsWith(".mpg")) mimeType = "video/mpeg";
        else if (lowerPath.endsWith(".avi")) mimeType = "video/x-msvideo";
        else if (lowerPath.endsWith(".webm")) mimeType = "video/webm";
      } catch (e) {
          console.warn(`${functionName} Could not parse URL "${videoUriForGemini}" for MIME type: ${e.message}. Defaulting to video/mp4.`);
      }
      console.log(`${functionName} Using MIME type: ${mimeType}`);

      // --- KEY CHANGE FOR METHOD 1: USING THE COMBINED PROMPT ---
      const geminiPayload = {
        contents: [{
          parts: [
            { text: viralClippingAndThemePrompt }, // <<<< THIS IS THE COMBINED PROMPT
            { fileData: { mimeType: mimeType, fileUri: videoUriForGemini } }
          ]
        }],
        safetySettings: safetySettings,
        generationConfig: generationConfig,
      };

      console.log(`${functionName} Sending request to Gemini API...`);
      const geminiResponse = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
      });
      console.log(`${functionName} Gemini API response status:`, geminiResponse.status);
      const responseBodyText = await geminiResponse.text();

      if (!geminiResponse.ok) {
         console.error(`${functionName} Gemini API error. Status:`, geminiResponse.status, 'Body:', responseBodyText);
         let geminiErrorMsg = `Gemini API request failed: ${geminiResponse.status}`;
         try { const parsedError = JSON.parse(responseBodyText); if (parsedError?.error?.message) geminiErrorMsg = `Gemini: ${parsedError.error.message}`; } catch (_e) { /* Ignore */ }
         throw new Error(geminiErrorMsg);
      }
      console.log(`${functionName} Gemini API call successful.`);

      const geminiResultRaw = JSON.parse(responseBodyText);
      const analysisText = geminiResultRaw?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!analysisText) {
        console.error(`${functionName} Invalid response from Gemini: Missing analysis text. Full result:`, JSON.stringify(geminiResultRaw, null, 2));
        throw new Error('Invalid response format from Gemini: Expected text content with analysis data was not found.');
      }
      console.log(`${functionName} Received raw analysis text from Gemini (first 200 chars):`, analysisText.substring(0,200) + "...");

      let parsableText = analysisText.trim();
      // Remove markdown code block fences if present
      if (parsableText.startsWith("```json")) {
        parsableText = parsableText.substring("```json".length);
      } else if (parsableText.startsWith("```")) {
        parsableText = parsableText.substring("```".length);
      }
      if (parsableText.endsWith("```")) {
        parsableText = parsableText.substring(0, parsableText.length - "```".length);
      }
      parsableText = parsableText.trim();

      console.log(`${functionName} Attempting to parse cleaned JSON object from Gemini (first 200 chars):`, parsableText.substring(0,200) + "...");
      
      // --- KEY CHANGE FOR METHOD 1: PARSING THE COMBINED JSON OBJECT ---
      const analysisResult = JSON.parse(parsableText);

      // Validate the new structure
      if (typeof analysisResult !== 'object' || analysisResult === null || !Array.isArray(analysisResult.identifiedClips) || !Array.isArray(analysisResult.suggestedVideoThemes)) {
          console.error(`${functionName} Parsed Gemini response is not the expected JSON object with 'identifiedClips' and 'suggestedVideoThemes' arrays:`, analysisResult);
          throw new Error("Parsed Gemini response was not in the expected format (object with 'identifiedClips' and 'suggestedVideoThemes' arrays).");
      }

      const initialClips = analysisResult.identifiedClips;
      const suggestedVideoThemes = analysisResult.suggestedVideoThemes; // <<<< EXTRACTING THEMES

      console.log(`${functionName} Successfully parsed ${initialClips.length} potential clips and ${suggestedVideoThemes.length} suggested themes.`);

      // ... (VERCEL_TEST_FUNCTION_URL handling - same as before)
      const VERCEL_TEST_FUNCTION_URL = Deno.env.get('VERCEL_TEST_FUNCTION_URL');
      if (VERCEL_TEST_FUNCTION_URL) {
         try {
           const testResponse = await fetch(VERCEL_TEST_FUNCTION_URL, { method: 'GET' });
           console.log(`${functionName} Vercel test function responded with status: ${testResponse.status}`);
         } catch (testError: any) {
           console.error(`${functionName} Failed to reach Vercel test function: ${testError.message}`);
         }
      }

      console.log(`${functionName} Video analysis complete. Returning success response to client.`);
      // --- KEY CHANGE FOR METHOD 1: RETURNING THEMES IN THE RESPONSE ---
      return new Response(JSON.stringify({
        message: "Analysis complete",
        initialClips, 
        suggestedVideoThemes, // <<<< INCLUDING THEMES HERE
        processedVideoDetails: {
          pathOrUrl: originalPathOrUrl,
          sourceType: processedVideoSourceType,
        }
      }), {
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });

    } catch (error: any) {
      // ... (Error handling - same as before)
      console.error(`${functionName} Error processing POST request:`, error.message, error.stack ? error.stack : '');
      const errorResponse = {
        error: 'Internal Server Error',
        error_message: error.message || 'An unexpected error occurred.',
      };
      return new Response(JSON.stringify(errorResponse), {
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
        status: 500
      });
    }
  }

  // ... (Method Not Allowed handling - same as before)
  console.warn(`${functionName} Method Not Allowed: Received ${req.method}.`);
  return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' },
    status: 405
  });
});

console.log("[PROCESS-VIDEO-V2] Supabase Edge Function 'process-video' (v2 with themes) initialized.");
console.log("[PROCESS-VIDEO-V2] Allowed Origins for CORS:", allowedOrigins.join(', '));