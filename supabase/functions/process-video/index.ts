// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CORS Configuration ---
// Define your allowed origins. Add any other URLs from which your frontend might call this function.
const VERCEL_PREVIEW_URL = 'https://clipping-generation-app-1far-cp7r9udye-zahtech123s-projects.vercel.app';
const VERCEL_PRODUCTION_URL = 'https://clipping-generation-app-1far.vercel.app'; // Your Vercel production deployment URL
const LOCALHOST_URL = 'http://localhost:5173'; // Your local development URL (ensure port matches)

const allowedOrigins = [
  VERCEL_PREVIEW_URL,
  VERCEL_PRODUCTION_URL,
  LOCALHOST_URL,
  // Add any other domains you need to whitelist here
];

// Function to generate appropriate CORS headers based on the request origin
function getDynamicCorsHeaders(requestOrigin: string | null): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS', // Specify allowed methods
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', // Specify allowed headers
    // Optional: 'Access-Control-Max-Age': '86400', // Cache preflight response for 1 day (in seconds)
  };

  // If the request origin is in our allowed list, reflect it in the Allow-Origin header
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    // If you were dealing with cookies or Authorization headers that require credentials:
    // headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    // If origin is not in the allowed list, DO NOT set 'Access-Control-Allow-Origin'.
    // The browser will then block the request due to CORS policy.
    console.warn(`CORS: Request from origin "${requestOrigin}" is not in the allowed list: [${allowedOrigins.join(', ')}]`);
  }
  return headers;
}
// --- End CORS Configuration ---


// Gemini API Safety Settings and Generation Configuration
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
  maxOutputTokens: 4096,
};

// --- Main Edge Function Handler ---
serve(async (req: Request) => {
  const requestOrigin = req.headers.get('Origin'); // Get the origin of the incoming request
  const requestUrl = req.url; // Get the full URL of the request to the function
  console.log(`[PROCESS-VIDEO] Incoming ${req.method} request from Origin: ${requestOrigin} to URL: ${requestUrl}`);

  // --- Get Dynamic CORS Headers ---
  // These headers will be determined based on whether the requestOrigin is allowed
  const responseCorsHeaders = getDynamicCorsHeaders(requestOrigin);

  // --- Handle OPTIONS Preflight Request ---
  // Browsers send OPTIONS requests before actual POST/PUT etc. to check CORS policy
  if (req.method === 'OPTIONS') {
    console.log("[PROCESS-VIDEO] Handling OPTIONS preflight request.");
    // Check if our dynamic function allowed the origin by seeing if 'Access-Control-Allow-Origin' was set
    if (responseCorsHeaders['Access-Control-Allow-Origin']) {
      console.log(`[PROCESS-VIDEO] Preflight CORS check successful for origin: ${requestOrigin}. Allowing request.`);
      // Respond with 204 No Content and the calculated CORS headers
      return new Response(null, { headers: responseCorsHeaders, status: 204 });
    } else {
      console.log(`[PROCESS-VIDEO] Preflight CORS check failed for origin: ${requestOrigin}. Origin not in allowed list. Denying request.`);
      // Respond with 403 Forbidden.
      // Crucially, DO NOT include 'Access-Control-Allow-Origin' if it wasn't matched.
      // Still return other CORS headers like Allow-Methods/Headers as the browser expects them.
      const forbiddenPreflightHeaders = { ...responseCorsHeaders }; // Copy to avoid modifying original
      delete forbiddenPreflightHeaders['Access-Control-Allow-Origin']; // Ensure it's not present
      return new Response(null, { headers: forbiddenPreflightHeaders, status: 403 });
    }
  }

  // --- Check Origin for Non-OPTIONS Requests (e.g., POST) ---
  // If 'Access-Control-Allow-Origin' was not set by getDynamicCorsHeaders, the origin is not permitted.
  if (!responseCorsHeaders['Access-Control-Allow-Origin']) {
      console.warn(`[PROCESS-VIDEO] Forbidden: Request from origin ${requestOrigin} is not allowed for ${req.method} request.`);
      // Return a clear error response. Do NOT include CORS headers that would allow the origin.
      return new Response(JSON.stringify({
          error: 'Cross-Origin Request Blocked',
          error_message: `Requests from origin '${requestOrigin}' are not permitted by the server's CORS policy for this resource.`
      }), {
          status: 403, // Forbidden
          headers: { 'Content-Type': 'application/json' } // Standard JSON response header
      });
  }

  // --- Environment Variable Retrieval ---
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  const SUPABASE_URL_ENV = Deno.env.get('SUPABASE_URL'); // Renamed to avoid conflict with local var
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const VERCEL_TEST_FUNCTION_URL = Deno.env.get('VERCEL_TEST_FUNCTION_URL'); // Optional

  // --- Critical Environment Variable Check ---
  if (!GEMINI_API_KEY || !SUPABASE_URL_ENV || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[PROCESS-VIDEO] FATAL: Missing critical server environment variables!', {
        GEMINI_API_KEY_PRESENT: !!GEMINI_API_KEY,
        SUPABASE_URL_PRESENT: !!SUPABASE_URL_ENV,
        SUPABASE_SERVICE_ROLE_KEY_PRESENT: !!SUPABASE_SERVICE_ROLE_KEY
    });
    // Return error response, including the CORS headers that *would have been applied* if origin was valid.
    return new Response(JSON.stringify({
        error: 'Server Configuration Error',
        error_message: 'The server is missing critical environment variables required to process your request.'
    }), {
      headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
      status: 500 // Internal Server Error
    });
  }

  const MODEL_NAME = "gemini-1.5-flash-latest";
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
  console.log("[PROCESS-VIDEO] Using Gemini model:", MODEL_NAME);

  // --- Handle POST Request Logic ---
  if (req.method === 'POST') {
    try {
      // Check Content-Type of the incoming request
      const contentType = req.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn("[PROCESS-VIDEO] Invalid content type received:", contentType);
        return new Response(JSON.stringify({
            error: 'Invalid Request Header',
            error_message: 'Content-Type header must be application/json for POST requests.'
        }), {
          headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
          status: 400 // Bad Request
        });
      }

      // Parse Request Body
      const requestBody = await req.json();
      const { uploadedVideoPath, videoUrl } = requestBody;

      let videoUriForGemini: string;
      let processedVideoSourceType: 'supabase' | 'external_url';
      let originalPathOrUrl: string;

      // --- Determine Video Source (Supabase Upload or External URL) ---
      if (uploadedVideoPath && typeof uploadedVideoPath === 'string') {
         console.log("[PROCESS-VIDEO] Processing Supabase uploaded video path:", uploadedVideoPath);
         originalPathOrUrl = uploadedVideoPath;
         processedVideoSourceType = 'supabase';

         // Initialize Supabase client with service role key for backend operations
         const supabaseAdminClient = createClient(SUPABASE_URL_ENV, SUPABASE_SERVICE_ROLE_KEY);
         console.log("[PROCESS-VIDEO] Supabase admin client initialized for uploaded video.");

         // Try getting public URL first (if bucket policy allows public read)
         const { data: publicUrlData } = supabaseAdminClient.storage
           .from('raw-videos') // Ensure this bucket name is correct
           .getPublicUrl(uploadedVideoPath);

         // Check if a valid public URL was returned (contains the path, not just base URL)
         if (publicUrlData?.publicUrl && publicUrlData.publicUrl.includes(uploadedVideoPath)) {
           videoUriForGemini = publicUrlData.publicUrl;
           console.log("[PROCESS-VIDEO] Using public URL for Supabase video:", videoUriForGemini);
         } else {
           // Fallback to creating a signed URL (valid for 1 hour)
           console.log("[PROCESS-VIDEO] Public URL not available or invalid, attempting signed URL for:", uploadedVideoPath);
           const { data: signedUrlData, error: signedUrlError } = await supabaseAdminClient.storage
             .from('raw-videos')
             .createSignedUrl(uploadedVideoPath, 3600); // 1 hour expiry

           if (signedUrlError || !signedUrlData?.signedUrl) {
             console.error("[PROCESS-VIDEO] Failed to get any accessible URL for Supabase video:", uploadedVideoPath, "Signed URL Error:", signedUrlError?.message);
             throw new Error(`Failed to create accessible URL for Supabase video: ${uploadedVideoPath}. ${signedUrlError?.message || 'Unknown error creating signed URL.'}`);
           }
           videoUriForGemini = signedUrlData.signedUrl;
           // Log only the start of the signed URL for security/brevity
           console.log("[PROCESS-VIDEO] Using signed URL for Supabase video (URL start):", videoUriForGemini.substring(0, videoUriForGemini.indexOf('?') > -1 ? videoUriForGemini.indexOf('?') : 80) + "...");
         }

      } else if (videoUrl && typeof videoUrl === 'string') {
         console.log("[PROCESS-VIDEO] Processing provided video URL:", videoUrl);
         try { new URL(videoUrl); } catch (_) { // Basic URL validation
             console.warn("[PROCESS-VIDEO] Invalid videoUrl format received:", videoUrl);
             return new Response(JSON.stringify({ error: 'Invalid Input', error_message: 'The provided videoUrl format is invalid.' }), {
                 headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' }, status: 400
             });
         }
         videoUriForGemini = videoUrl;
         originalPathOrUrl = videoUrl;
         processedVideoSourceType = 'external_url';
         console.log("[PROCESS-VIDEO] Using provided external URL directly for Gemini:", videoUriForGemini);
      } else {
        console.warn("[PROCESS-VIDEO] Missing 'uploadedVideoPath' or 'videoUrl' in request body.");
        return new Response(JSON.stringify({ error: 'Missing Input', error_message: 'Either "uploadedVideoPath" or "videoUrl" is required in the request body.' }), {
          headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' }, status: 400
        });
      }

      // --- Determine MIME Type for Gemini ---
      let mimeType = "video/mp4"; // Default
      try {
        // Extract path part before query string for extension check
        const pathPart = new URL(videoUriForGemini).pathname; // This can throw if videoUriForGemini is not a valid URL
        const lowerPath = pathPart.toLowerCase();
        if (lowerPath.endsWith(".mov")) mimeType = "video/quicktime";
        else if (lowerPath.endsWith(".mpeg") || lowerPath.endsWith(".mpg")) mimeType = "video/mpeg";
        else if (lowerPath.endsWith(".avi")) mimeType = "video/x-msvideo";
        else if (lowerPath.endsWith(".webm")) mimeType = "video/webm";
        else if (lowerPath.endsWith(".mp4")) mimeType = "video/mp4";
        // Add other types if Gemini supports them (e.g., .mkv -> video/x-matroska)
      } catch (e) {
          console.warn(`[PROCESS-VIDEO] Could not parse URL "${videoUriForGemini}" to determine MIME type from extension: ${e.message}. Defaulting to video/mp4.`);
      }
      console.log(`[PROCESS-VIDEO] Using MIME type: ${mimeType} for Gemini URI (start): ${videoUriForGemini.substring(0,80)}...`);


      // --- Prepare Gemini API Payload ---
      const geminiPayload = {
        contents: [{
          parts: [
            { text: `Analyze this video and identify key moments that would make good short clips (5-60 seconds). For each potential clip, provide ONLY: 1. "startTime" (integer, in seconds from the beginning of the video), 2. "endTime" (integer, in seconds from the beginning of the video), 3. "description" (a concise, engaging, one-sentence summary of the clip's content, suitable for a social media post title), 4. "transcription" (a short, key quote or phrase from the clip's audio, if discernible and relevant, otherwise "N/A"). Format your response as a valid JSON array of objects. Each object should strictly follow this structure: {"startTime": <seconds>, "endTime": <seconds>, "description": "concise summary", "transcription": "key quote or N/A"}. Do not include any other fields or introductory text. Ensure startTime is less than endTime.` },
            { fileData: { mimeType: mimeType, fileUri: videoUriForGemini } }
          ]
        }],
        safetySettings: safetySettings,
        generationConfig: generationConfig,
      };

      // --- Call Gemini API ---
      console.log("[PROCESS-VIDEO] Sending request to Gemini API...");
      const geminiResponse = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
      });
      console.log("[PROCESS-VIDEO] Gemini API response status:", geminiResponse.status);
      const responseBodyText = await geminiResponse.text(); // Read response body once

      if (!geminiResponse.ok) {
         console.error('[PROCESS-VIDEO] Gemini API error. Status:', geminiResponse.status, 'Response Body:', responseBodyText);
         let geminiErrorMsg = `Gemini API request failed with status ${geminiResponse.status}`;
         try { // Try to parse more specific error from Gemini JSON response
            const parsedError = JSON.parse(responseBodyText);
            if (parsedError?.error?.message) {
                geminiErrorMsg = `Gemini API Error: ${parsedError.error.message}`;
            }
         } catch (_e) { /* Ignore parsing error if Gemini response wasn't JSON, use status-based message */ }
         throw new Error(geminiErrorMsg);
      } else {
        console.log("[PROCESS-VIDEO] Gemini API call successful.");
      }

      // --- Process Gemini API Response ---
      const geminiResult = JSON.parse(responseBodyText); // Parse the successful response text
      // Navigate the Gemini response structure to get the text part containing clip data
      const highlightsText = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!highlightsText) {
        console.error("[PROCESS-VIDEO] Invalid response format from Gemini: Missing highlights text. Full Gemini result:", JSON.stringify(geminiResult, null, 2));
        throw new Error('Invalid response format from Gemini: Expected text content with clip data was not found.');
      }
      console.log("[PROCESS-VIDEO] Received raw highlights text from Gemini (first 100 chars):", highlightsText.substring(0,100) + "...");

      let parsableText = highlightsText; // Keep original for error logging if needed
      try {
        // Clean potential markdown code blocks (```json ... ``` or ``` ... ```) from Gemini's response
        parsableText = highlightsText.trim();
        if (parsableText.startsWith("```json")) {
          parsableText = parsableText.substring("```json".length);
        } else if (parsableText.startsWith("```")) {
          parsableText = parsableText.substring("```".length);
        }
        if (parsableText.endsWith("```")) {
          parsableText = parsableText.substring(0, parsableText.length - "```".length);
        }
        parsableText = parsableText.trim(); // Trim again after removing backticks

        console.log("[PROCESS-VIDEO] Attempting to parse cleaned text from Gemini (first 100 chars):", parsableText.substring(0,100) + "...");
        const initialClips = JSON.parse(parsableText); // Parse the cleaned text into an array of clip objects

        // Basic validation of parsed clips (check if it's an array)
        if (!Array.isArray(initialClips)) {
            console.error("[PROCESS-VIDEO] Parsed Gemini response is not a JSON array as expected:", initialClips);
            throw new Error("Parsed Gemini response was not in the expected array format. Check Gemini prompt and output.");
        }
        console.log(`[PROCESS-VIDEO] Successfully parsed ${initialClips.length} potential clips from Gemini response.`);


        // --- (Optional) VERCEL TEST FUNCTION CALL ---
        if (VERCEL_TEST_FUNCTION_URL) {
           console.log(`[PROCESS-VIDEO] Attempting to test Vercel function at: ${VERCEL_TEST_FUNCTION_URL}`);
           try {
             const testResponse = await fetch(VERCEL_TEST_FUNCTION_URL, { method: 'GET' });
             console.log(`[PROCESS-VIDEO] Vercel test function responded with status: ${testResponse.status}`);
           } catch (testError: any) {
             console.error(`[PROCESS-VIDEO] Failed to reach or execute Vercel test function: ${testError.message}`);
           }
        } else {
          console.log("[PROCESS-VIDEO] VERCEL_TEST_FUNCTION_URL environment variable not set, skipping Vercel function test call.");
        }
        // --- End Vercel Test ---


        // --- Return Success Response to Client ---
        console.log("[PROCESS-VIDEO] Video analysis complete. Returning success response to client.");
        return new Response(JSON.stringify({
          message: "Analysis complete",
          initialClips, // The array of clip objects
          processedVideoDetails: { // Details about the source video processed
            pathOrUrl: originalPathOrUrl,
            sourceType: processedVideoSourceType,
          }
        }), {
          // Use the dynamic CORS headers determined at the start of the function
          headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
          status: 200 // OK
        });

      } catch (parseError: any) {
        // Handle JSON parsing errors specifically if Gemini's response isn't valid JSON
        console.error("[PROCESS-VIDEO] Failed to parse JSON response from Gemini:", parseError.message);
        console.error("[PROCESS-VIDEO] Problematic highlights text received from Gemini (raw):", highlightsText);
        console.error("[PROCESS-VIDEO] Text that failed parsing (after cleaning attempt):", parsableText);
        const errorDetail = parsableText.length > 500 ? parsableText.substring(0, 500) + "..." : parsableText; // Avoid logging excessively large strings
        // Throw a new error to be caught by the outer try/catch block for consistent error response
        throw new Error(`Failed to parse Gemini response as JSON. Error: ${parseError.message}. Gemini response (partial): ${errorDetail}`);
      }

    } catch (error: any) {
      // --- Handle General Errors during POST Request Processing ---
      console.error('[PROCESS-VIDEO] Error processing POST request:', error.message);
      if (error.stack) console.error('[PROCESS-VIDEO] Stack trace:', error.stack);
      else console.error('[PROCESS-VIDEO] Full error object:', error);

      // Return an error response to the client, including the dynamic CORS headers
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        error_message: error.message || 'An unexpected error occurred while processing the video.' // Provide a fallback message
      }), {
        headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
        status: 500 // Internal Server Error
      });
    }
  }

  // --- Handle Methods Other Than POST or OPTIONS ---
  console.warn(`[PROCESS-VIDEO] Method Not Allowed: Received ${req.method}, but only POST and OPTIONS are supported.`);
  return new Response(JSON.stringify({
      error: 'Method Not Allowed',
      error_message: `The method ${req.method} is not allowed for this resource. Please use POST.`
  }), {
    // Include dynamic CORS headers and an 'Allow' header indicating supported methods
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' },
    status: 405 // Method Not Allowed
  });
});

// Log when the function initializes (this runs when the Deno runtime starts the function)
console.log("[PROCESS-VIDEO] Supabase Edge Function 'process-video' initialized and awaiting requests.");
console.log("[PROCESS-VIDEO] Allowed Origins for CORS:", allowedOrigins.join(', '));