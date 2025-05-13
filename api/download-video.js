// File: clipping-generation-app/api/download-video.js
import { createClient } from '@supabase/supabase-js';
import ytdl from 'ytdl-core';
// import { Writable } from 'stream'; // Writable import is not strictly needed for res.pipe

// Initialize Supabase Client (using environment variables set in Vercel)
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY; // Prefer Anon key for this

if (!supabaseUrl || !supabaseKey) {
    console.error("DOWNLOAD_VIDEO_FUNCTION: Supabase URL and Key environment variables are required.");
    // This state will be caught by the handler's check below
}

// Helper to extract a basic filename
function getFilename(identifier, sourceType) {
    let filename = `video_download_${Date.now()}.mp4`; // Default
    try {
        if (sourceType === 'supabase') {
            const parts = identifier.split('/');
            filename = parts[parts.length - 1] || `video_${Date.now()}.mp4`;
        } else if (sourceType === 'external_url') {
            const url = new URL(identifier); // This can throw if identifier is not a valid URL
            const pathParts = url.pathname.split('/');
            const lastPart = pathParts[pathParts.length - 1];

            if (lastPart && lastPart.includes('.')) { // Check if it looks like a filename with extension
                filename = decodeURIComponent(lastPart); // Decode URI components in filename
            } else if (ytdl.validateURL(identifier)) {
                const videoId = ytdl.getVideoID(identifier);
                // Fetching actual YouTube title is async, for simplicity using ID
                filename = `youtube_${videoId || Date.now()}.mp4`;
            } else {
                // Fallback for URLs without clear filename in path
                filename = `external_video_${Date.now()}.mp4`;
            }
        }
    } catch (e) {
        console.warn("DOWNLOAD_VIDEO_FUNCTION: Error parsing identifier for filename:", identifier, e.message);
    }
    // Sanitize filename to prevent issues
    return filename.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/_{2,}/g, '_');
}


export default async function handler(req, res) {
    console.log(`[DOWNLOAD_VIDEO] Request received: ${req.method} ${req.url}`);

    // Check Supabase config availability early
    if (!supabaseUrl || !supabaseKey) {
        console.error("[DOWNLOAD_VIDEO] Server configuration error: Supabase credentials missing in environment.");
        res.status(500).json({ error: "Server configuration error: Supabase credentials missing." });
        return;
    }
    // Initialize Supabase client here, after check, to avoid error if env vars are missing.
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (req.method !== 'GET') {
        console.log(`[DOWNLOAD_VIDEO] Method ${req.method} not allowed.`);
        res.setHeader('Allow', ['GET']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
        return;
    }

    const { sourceType, identifier } = req.query;

    if (!sourceType || !identifier) {
        console.log("[DOWNLOAD_VIDEO] Missing 'sourceType' or 'identifier' query parameters.");
        res.status(400).json({ error: "Missing 'sourceType' or 'identifier' query parameters." });
        return;
    }

    // decodedIdentifier is usually handled by the framework, but being explicit is fine.
    const decodedIdentifier = typeof identifier === 'string' ? decodeURIComponent(identifier) : '';
    if (!decodedIdentifier) {
        console.log("[DOWNLOAD_VIDEO] Invalid 'identifier' query parameter after decoding.");
        res.status(400).json({ error: "Invalid 'identifier' query parameter." });
        return;
    }

    const filenameToUse = getFilename(decodedIdentifier, sourceType);
    console.log(`[DOWNLOAD_VIDEO] Processing download: sourceType=${sourceType}, identifier (start)=${decodedIdentifier.substring(0, 60)}..., filename=${filenameToUse}`);

    try {
        if (sourceType === 'external_url') {
            if (ytdl.validateURL(decodedIdentifier)) {
                console.log("[DOWNLOAD_VIDEO] Identified as YouTube URL. Attempting to stream with ytdl-core.");
                try {
                    // It's good practice to ensure headers are set before starting the pipe
                    res.setHeader('Content-Type', 'video/mp4'); // Default to mp4, ytdl-core might provide more specific
                    res.setHeader('Content-Disposition', `attachment; filename="${filenameToUse}"`);
                    
                    const videoStream = ytdl(decodedIdentifier, {
                        quality: 'highestaudioandvideo', // Request a format with both
                        // filter: 'audioandvideo', // Alternative way to specify
                    });

                    videoStream.on('info', (info, format) => {
                        console.log(`[DOWNLOAD_VIDEO] ytdl-core info: Title: ${info.videoDetails.title}, Format container: ${format.container}`);
                        // Optionally update Content-Type if format provides a more specific one
                        if (format.mimeType) {
                            res.setHeader('Content-Type', format.mimeType);
                            console.log(`[DOWNLOAD_VIDEO] Updated Content-Type to: ${format.mimeType}`);
                        }
                    });

                    videoStream.on('error', (streamErr) => {
                       console.error("[DOWNLOAD_VIDEO] Error during ytdl stream:", streamErr.message);
                       // If headers haven't been sent, we can try to send an error status
                       if (!res.headersSent) {
                           res.status(500).json({ error: `Error streaming video: ${streamErr.message}` });
                       } else {
                           // If headers are sent, the stream is likely broken. End the response.
                           res.end();
                       }
                    });
                    
                    videoStream.pipe(res);

                } catch (ytdlError) {
                    console.error("[DOWNLOAD_VIDEO] ytdl-core processing error:", ytdlError);
                    if (!res.headersSent) {
                        res.status(500).json({ error: `Failed to process YouTube URL: ${ytdlError.message}` });
                    }
                }
            } else {
                // --- Handle Direct URL (Non-YouTube) ---
                console.log("[DOWNLOAD_VIDEO] Identified as Direct URL. Redirecting user to:", decodedIdentifier);
                // For direct file URLs, redirecting is often the simplest and most efficient.
                // The browser will handle the download based on the target server's headers.
                res.redirect(307, decodedIdentifier); // 307 Temporary Redirect
            }

        } else if (sourceType === 'supabase') {
            // --- Handle Supabase Storage Path ---
            console.log(`[DOWNLOAD_VIDEO] Generating signed URL for Supabase path: ${decodedIdentifier}`);
            // Ensure 'raw-videos' matches your bucket name
            const { data, error } = await supabase.storage
                .from('raw-videos')
                .createSignedUrl(decodedIdentifier, 300, { // Signed URL valid for 300 seconds (5 minutes)
                    download: true // This crucial option tells Supabase to set Content-Disposition for download
                });

            if (error) {
                console.error("[DOWNLOAD_VIDEO] Supabase signed URL generation error:", error);
                throw new Error(`Failed to get download URL from Supabase: ${error.message}`);
            }

            if (!data || !data.signedUrl) {
                 console.error("[DOWNLOAD_VIDEO] Supabase did not return a signed URL.");
                 throw new Error("Supabase did not return a signed URL.");
            }

            console.log("[DOWNLOAD_VIDEO] Redirecting user to Supabase signed download URL.");
            res.redirect(307, data.signedUrl); // Redirect user to the Supabase URL

        } else {
            console.log(`[DOWNLOAD_VIDEO] Invalid sourceType received: ${sourceType}`);
            res.status(400).json({ error: `Invalid sourceType: ${sourceType}` });
        }

    } catch (error) {
        console.error(`[DOWNLOAD_VIDEO] General error in download function (sourceType: ${sourceType}):`, error.message, error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: `Internal Server Error: ${error.message}` });
        } else {
            // If headers were already sent (e.g., during a failed stream), just end the response.
            console.log("[DOWNLOAD_VIDEO] Headers already sent, ending response due to error.");
            res.end(); // Corrected: no extra 's'
        }
    }
}