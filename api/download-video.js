// File: clipping-generation-app/api/download-video.js
import { createClient } from '@supabase/supabase-js';
import ytdl from 'ytdl-core';
import { Writable } from 'stream'; // Import Writable for pipe method typing

// Initialize Supabase Client (using environment variables set in Vercel)
// IMPORTANT: Use Anon Key if possible for downloading public/signed URLs.
// Use Service Role Key ONLY if necessary and understand the security implications.
const supabaseUrl = process.env.VITE_SUPABASE_URL; // Use the same env var name as your frontend for consistency
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY; // Prefer Anon key

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL and Key environment variables are required for the download function.");
    // Don't throw here, let the handler fail gracefully
}

// Helper to extract a basic filename
function getFilename(identifier, sourceType) {
    try {
        if (sourceType === 'supabase') {
            const parts = identifier.split('/');
            return parts[parts.length - 1] || `video_${Date.now()}.mp4`;
        }
        if (sourceType === 'external_url') {
            const url = new URL(identifier);
            const pathParts = url.pathname.split('/');
            const lastPart = pathParts[pathParts.length - 1];
            // Basic check if it looks like a filename with extension
            if (lastPart && lastPart.includes('.')) {
                return lastPart;
            }
            // Fallback for YouTube or URLs without clear filenames
            if (ytdl.validateURL(identifier)) {
                // Note: Getting title might require an async call, keeping it simple for now
                const videoId = ytdl.getVideoID(identifier);
                return `youtube_${videoId || Date.now()}.mp4`;
            }
        }
    } catch (e) {
        console.warn("Error parsing identifier for filename:", e);
    }
    // Default fallback
    return `video_download_${Date.now()}.mp4`;
}


export default async function handler(req, res) {
    // Check Supabase config availability early
    if (!supabaseUrl || !supabaseKey) {
        res.status(500).json({ error: "Server configuration error: Supabase credentials missing." });
        return;
    }
    const supabase = createClient(supabaseUrl, supabaseKey);


    // Use GET method for simplicity with query parameters
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
        return;
    }

    const { sourceType, identifier } = req.query;

    if (!sourceType || !identifier) {
        res.status(400).json({ error: "Missing 'sourceType' or 'identifier' query parameters." });
        return;
    }

    const decodedIdentifier = decodeURIComponent(identifier); // Should already be decoded by framework, but good practice
    const filename = getFilename(decodedIdentifier, sourceType);

    console.log(`Download request received: sourceType=${sourceType}, identifier=${decodedIdentifier.substring(0, 60)}...`);

    try {
        if (sourceType === 'external_url') {
            // --- Handle External URL (YouTube or Direct) ---
            if (ytdl.validateURL(decodedIdentifier)) {
                console.log("Identified as YouTube URL. Attempting to stream with ytdl-core.");
                try {
                    const info = await ytdl.getInfo(decodedIdentifier);
                    // Simple approach: find a format with both audio and video
                    const format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo' });
                    if (!format) {
                         console.warn("No suitable audio+video format found, trying video only.");
                         const videoOnlyFormat = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });
                         if (!videoOnlyFormat) throw new Error("Could not find a suitable download format.");
                         // Note: This might result in video without audio
                         console.log(`Streaming video only format: ${videoOnlyFormat.container}`);
                         res.setHeader('Content-Type', videoOnlyFormat.mimeType || 'video/mp4');
                         res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); // Use derived filename
                         ytdl(decodedIdentifier, { format: videoOnlyFormat }).pipe(res);

                    } else {
                        console.log(`Streaming format: ${format.container}, Quality: ${format.qualityLabel}`);
                        res.setHeader('Content-Type', format.mimeType || 'video/mp4');
                        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); // Use derived filename
                        ytdl(decodedIdentifier, { format: format }).pipe(res);
                    }

                    // Handle errors during the pipe
                    // Note: Vercel might handle stream errors, but explicit handling is safer
                    res.on('error', (streamErr) => {
                       console.error("Error piping YouTube stream to response:", streamErr);
                       // Don't try to write headers/status if already sent
                    });


                } catch (ytdlError) {
                    console.error("ytdl-core error:", ytdlError);
                    res.status(500).json({ error: `Failed to process YouTube URL: ${ytdlError.message}` });
                }
            } else {
                // --- Handle Direct URL (Non-YouTube) ---
                console.log("Identified as Direct URL. Redirecting user.");
                // Redirecting is generally better than proxying large files through the function
                // 307 Temporary Redirect preserves the method (GET)
                res.redirect(307, decodedIdentifier);
            }

        } else if (sourceType === 'supabase') {
            // --- Handle Supabase Storage Path ---
            console.log(`Generating signed URL for Supabase path: ${decodedIdentifier}`);
            const { data, error } = await supabase.storage
                .from('raw-videos') // Make sure this matches the bucket you uploaded to
                .createSignedUrl(decodedIdentifier, 300, { // 300 seconds (5 minutes) validity
                    download: true // Force download behavior with Content-Disposition
                });

            if (error) {
                console.error("Supabase signed URL error:", error);
                throw new Error(`Failed to get download URL from Supabase: ${error.message}`);
            }

            if (!data || !data.signedUrl) {
                 throw new Error("Supabase did not return a signed URL.");
            }

            console.log("Redirecting user to Supabase signed URL.");
            res.redirect(307, data.signedUrl); // Redirect user to the download URL

        } else {
            res.status(400).json({ error: `Invalid sourceType: ${sourceType}` });
        }

    } catch (error) {
        console.error(`Error in download function (sourceType: ${sourceType}):`, error);
        // Avoid sending headers again if they were already partially sent (e.g., during streaming)
        if (!res.headersSent) {
            res.status(500).json({ error: `Internal Server Error: ${error.message}` });
        } else {
            // If headers sent, just try to end the response abruptly if possible
             res.end();
        }
    }
}