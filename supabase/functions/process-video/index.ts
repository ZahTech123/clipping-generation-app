// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:5173', // Or your specific frontend URL / '*' for development
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

serve(async (req: Request) => {
  console.log(`Incoming ${req.method} request to ${req.url}`);

  if (req.method === 'OPTIONS') {
    console.log("Handling OPTIONS preflight");
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // --- Environment Variable Retrieval ---
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const VERCEL_TEST_FUNCTION_URL = Deno.env.get('VERCEL_TEST_FUNCTION_URL'); // <-- Add this

  // --- Critical Environment Variable Check ---
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing critical environment variables:', {
      GEMINI_API_KEY_PRESENT: !!GEMINI_API_KEY,
      SUPABASE_URL_PRESENT: !!SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY_PRESENT: !!SUPABASE_SERVICE_ROLE_KEY
    });
    return new Response(JSON.stringify({ error: 'Server configuration error: Missing critical environment variables.', error_message: 'Server configuration error: Missing critical environment variables.'}), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }

  const MODEL_NAME = "gemini-1.5-flash-latest";
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
  console.log("Using Gemini model:", MODEL_NAME);

  if (req.method === 'POST') {
    try {
      const contentType = req.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn("Invalid content type received:", contentType);
        return new Response(JSON.stringify({ error: 'Invalid content type', error_message: 'Invalid content type' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

      const requestBody = await req.json();
      const { uploadedVideoPath, videoUrl } = requestBody;

      let videoUriForGemini: string;
      let processedVideoSourceType: 'supabase' | 'external_url';
      let originalPathOrUrl: string;

      // --- Determine Video Source (Supabase or URL) ---
      if (uploadedVideoPath && typeof uploadedVideoPath === 'string') {
        console.log("Processing Supabase uploaded video path:", uploadedVideoPath);
        originalPathOrUrl = uploadedVideoPath;
        processedVideoSourceType = 'supabase';

        const supabaseAdminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        console.log("Supabase admin client initialized for uploaded video.");

        // Try getting public URL first
        const { data: publicUrlData, error: publicUrlError } = supabaseAdminClient.storage
          .from('raw-videos')
          .getPublicUrl(uploadedVideoPath);

        if (publicUrlError || !publicUrlData?.publicUrl) {
          console.log("Failed to get public URL, attempting signed URL for:", uploadedVideoPath, "Public URL Error:", publicUrlError?.message);
          // Fallback to signed URL
          const { data: signedUrlData, error: signedUrlError } = await supabaseAdminClient.storage
            .from('raw-videos')
            .createSignedUrl(uploadedVideoPath, 3600); // Signed URL valid for 1 hour

          if (signedUrlError || !signedUrlData?.signedUrl) {
            console.error("Failed to get any accessible URL for Supabase video:", uploadedVideoPath, "Signed URL Error:", signedUrlError?.message);
            throw new Error(`Failed to get accessible URL for video: ${uploadedVideoPath}. ${signedUrlError?.message || 'Unknown error'}`);
          }
          videoUriForGemini = signedUrlData.signedUrl;
          console.log("Using signed URL for Supabase video (path only for brevity):", videoUriForGemini.substring(0, videoUriForGemini.indexOf('?') > -1 ? videoUriForGemini.indexOf('?') : 80));
        } else {
          videoUriForGemini = publicUrlData.publicUrl;
          console.log("Using public URL for Supabase video:", videoUriForGemini);
        }

      } else if (videoUrl && typeof videoUrl === 'string') {
        console.log("Processing provided video URL:", videoUrl);
        try { new URL(videoUrl); } catch (_) { // Basic URL validation
            console.warn("Invalid videoUrl format received:", videoUrl);
            return new Response(JSON.stringify({ error: 'Invalid videoUrl format.', error_message: 'Invalid videoUrl format.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
            });
        }
        videoUriForGemini = videoUrl;
        originalPathOrUrl = videoUrl;
        processedVideoSourceType = 'external_url';
        console.log("Using provided external URL directly for Gemini:", videoUriForGemini);
      } else {
        console.warn("Missing 'uploadedVideoPath' or 'videoUrl' in request body");
        return new Response(JSON.stringify({ error: 'Either uploadedVideoPath or videoUrl is required.', error_message: 'Either uploadedVideoPath or videoUrl is required.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
        });
      }

      // --- Determine MIME Type ---
      let mimeType = "video/mp4"; // Default
      const uriToCheck = videoUriForGemini.toLowerCase().split('?')[0];
      if (uriToCheck.endsWith(".mov")) mimeType = "video/quicktime";
      else if (uriToCheck.endsWith(".mpeg")) mimeType = "video/mpeg";
      else if (uriToCheck.endsWith(".avi")) mimeType = "video/x-msvideo";
      else if (uriToCheck.endsWith(".webm")) mimeType = "video/webm";
      // else if (uriToCheck.endsWith(".mp4")) mimeType = "video/mp4"; // Already default

      console.log(`Using MIME type: ${mimeType} for URI: ${videoUriForGemini.substring(0,80)}...`);

      // --- Prepare Gemini Payload ---
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
      console.log("Sending request to Gemini. Payload fileUri (first 80 chars):", videoUriForGemini.substring(0,80));
      const geminiResponse = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
      });
      console.log("Gemini response status:", geminiResponse.status);
      const responseBodyText = await geminiResponse.text();

      if (!geminiResponse.ok) {
         console.error('Gemini API error. Status:', geminiResponse.status, 'Response Body:', responseBodyText);
         let geminiErrorMsg = `Gemini API request failed: ${geminiResponse.status}`;
         try {
            const parsedError = JSON.parse(responseBodyText);
            if (parsedError.error && parsedError.error.message) {
                geminiErrorMsg = `Gemini API Error: ${parsedError.error.message}`;
            }
         } catch (_e) { /* ignore parsing error, use original message */ }
         throw new Error(geminiErrorMsg);
      } else {
        console.log("Gemini API call successful.");
      }

      // --- Process Gemini Response ---
      const geminiResult = JSON.parse(responseBodyText);
      const highlightsText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!highlightsText) {
        console.error("Missing highlights text in Gemini response. Full result:", JSON.stringify(geminiResult));
        throw new Error('Invalid response format from Gemini: Missing highlights text');
      }
      console.log("Received raw highlights text from Gemini (first 100 chars):", highlightsText.substring(0,100) + "...");

      let parsableText = highlightsText; // Keep original for error logging if needed
      try {
        // Clean potential Markdown code blocks
        parsableText = highlightsText.trim();
        if (parsableText.startsWith("```json")) {
          parsableText = parsableText.substring("```json".length);
        } else if (parsableText.startsWith("```")) {
          parsableText = parsableText.substring("```".length);
        }
        if (parsableText.endsWith("```")) {
          parsableText = parsableText.substring(0, parsableText.length - "```".length);
        }
        parsableText = parsableText.trim();

        console.log("Attempting to parse cleaned text (first 100 chars):", parsableText.substring(0,100) + "...");
        const initialClips = JSON.parse(parsableText);
        console.log("Successfully parsed clips from Gemini response. Number of clips:", initialClips.length);

        // --------------------------------------------------
        // --- VERCEL TEST FUNCTION CALL (Start) ---
        // --------------------------------------------------
        if (VERCEL_TEST_FUNCTION_URL) {
          console.log(`Attempting to test Vercel function at: ${VERCEL_TEST_FUNCTION_URL}`);
          try {
            // Make a simple GET request to the test URL
            const testResponse = await fetch(VERCEL_TEST_FUNCTION_URL, { method: 'GET' });

            if (testResponse.ok) {
              // Success! Log the status. You could potentially read the body too if needed.
              console.log(`Vercel test function responded successfully with status: ${testResponse.status}`);
              // Optional: Log the response body
              // const testBody = await testResponse.text();
              // console.log("Vercel test response body:", testBody);
            } else {
              // The Vercel function responded, but with an error status code.
              console.warn(`Vercel test function responded with error status: ${testResponse.status}`);
              // Optional: Log the error response body
              // try {
              //   const errorBody = await testResponse.text();
              //   console.warn("Vercel test error response body:", errorBody);
              // } catch (bodyError) {
              //   console.warn("Could not read Vercel test error response body:", bodyError.message);
              // }
            }
          } catch (testError: any) {
            // Failed to connect to or execute the Vercel function (network error, DNS error, etc.)
            console.error(`Failed to reach or execute Vercel test function: ${testError.message}`);
            // Note: This error does NOT stop the main Supabase function from returning successfully.
          }
        } else {
          // Log that the test was skipped because the URL wasn't provided.
          console.log("VERCEL_TEST_FUNCTION_URL environment variable not set, skipping Vercel function test call.");
        }
        // --------------------------------------------------
        // --- VERCEL TEST FUNCTION CALL (End) ---
        // --------------------------------------------------


        // --- Return Success Response ---
        return new Response(JSON.stringify({
          message: "Analysis complete",
          initialClips,
          processedVideoDetails: {
            pathOrUrl: originalPathOrUrl,
            sourceType: processedVideoSourceType,
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });

      } catch (parseError: any) {
        // --- Handle JSON Parsing Error from Gemini Response ---
        console.error("JSON parse error on highlightsText from Gemini:", parseError.message);
        console.error("Problematic highlightsText (raw):", highlightsText);
        console.error("Text that was attempted to be parsed:", parsableText);
        const errorDetail = parsableText.length > 500 ? parsableText.substring(0, 500) + "..." : parsableText;
        throw new Error(`Failed to parse Gemini response JSON. Error: ${parseError.message}. Gemini response (partial): ${errorDetail}`);
      }

    } catch (error: any) {
      // --- Handle General Errors in POST Handler ---
      console.error('Error in POST handler:', error.message);
      if (error.stack) console.error('Stack trace:', error.stack);
      else console.error('Full error object:', error);
      return new Response(JSON.stringify({
        error: `Internal Server Error: ${error.message}`,
        error_message: error.message // Ensure error_message is included for client parsing
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      });
    }
  }

  // --- Handle Non-POST Requests ---
  console.warn("Method not allowed:", req.method);
  return new Response(JSON.stringify({ error: 'Method not allowed', error_message: 'Method not allowed' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 405
  });
});