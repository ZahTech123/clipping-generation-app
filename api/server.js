import express from 'express';
import downloadHandler from './download-video.js'; // Import the handler
import cors from 'cors'; // Import cors middleware
import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js'; // Needed for Supabase download
import https from 'https'; // For downloading from Supabase URL
import fs from 'fs'; // For file system operations (temp files)
import path from 'path'; // For path manipulation
import crypto from 'crypto'; // For generating unique filenames
import { fileURLToPath } from 'url'; // To get __dirname in ES modules
import fsp from 'fs/promises'; // Add fsp for promise-based fs operations

// Helper to get directory name in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure a temporary directory exists
const tempDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Define the path inside the container where host downloads will be mounted
const HOST_DOWNLOADS_PATH_IN_CONTAINER = '/data/host_downloads';

const app = express();
const port = process.env.PORT || 3000; // Use environment variable for port or default to 3000

// --- Enable CORS ---
// This allows requests from any origin. For production, you might want to restrict this
// to your specific frontend URL: app.use(cors({ origin: 'YOUR_FRONTEND_URL' }));
app.use(cors({ exposedHeaders: 'X-Clip-Filename' }));
// --- End CORS ---

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`[SERVER] Received request: ${req.method} ${req.url}`);
  next();
});

// --- Supabase Client (needed for clip function too) ---
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
let supabase;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
} else {
    console.error("[SERVER] Supabase URL/Key missing - Supabase features in clip function will fail.");
}
// --- End Supabase Client ---

// Route for API health check (mimicking api/hello.js)
app.get('/api/hello', (req, res) => {
  console.log("[SERVER] Received request for /api/hello");
  res.status(200).json({ message: "Hello from local API!" }); // Adjusted message for clarity
});

// Define the route that maps to your download function
// It expects sourceType and identifier as query parameters
app.get('/api/download-video', async (req, res) => {
  // Check for required Supabase environment variables needed by the handler
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
      console.error("[SERVER] Supabase URL and Key environment variables are required but missing.");
      // Set them for the handler, even if empty, so the handler's internal check triggers
      // Or handle the error directly here:
      res.status(500).json({ error: "Server configuration error: Supabase credentials missing." });
      return;
  }

  try {
    // Call the original handler, passing the Express req and res objects
    // The handler is designed for a similar signature (like Vercel functions)
    await downloadHandler(req, res);
  } catch (error) {
    console.error('[SERVER] Error calling download handler:', error);
    // Ensure response is sent if the handler failed without sending one
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// --- NEW: /api/clip-video Route ---
app.get('/api/clip-video', async (req, res) => {
    console.log(`[CLIP_VIDEO] Request received: ${req.method} ${req.url}`);
    const { identifier, sourceType, startTime, endTime, inputFileName } = req.query;

    // Basic validation
    if (startTime === undefined || endTime === undefined) {
        return res.status(400).json({ error: "Missing required query parameters: startTime, endTime" });
    }
    // Further validation depends on whether inputFileName or sourceType/identifier is used
    if (!inputFileName && (!identifier || !sourceType)) {
        return res.status(400).json({ error: "Missing required query parameters: provide inputFileName OR identifier and sourceType" });
    }

    const start = parseFloat(startTime);
    const end = parseFloat(endTime);
    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
        return res.status(400).json({ error: "Invalid startTime or endTime parameters." });
    }
    const decodedIdentifier = identifier ? decodeURIComponent(identifier) : null;

    // Generate temporary file paths OR use inputFileName
    const uniqueId = crypto.randomBytes(8).toString('hex');
    // Output filename for the clip
    const baseNameForClip = inputFileName ? path.basename(inputFileName, path.extname(inputFileName)) : (decodedIdentifier ? uniqueId : 'video');
    const clipFilename = `clip_${baseNameForClip}_${start}-${end}.mp4`; 
    
    let videoSourcePathForFFmpeg; // This will be the actual path ffmpeg uses
    let tempInputDownloadPath; // Path for temporary download if not using inputFileName
    let cleanupDownloadFiles = false; // Flag to indicate if temp download files need cleanup

    console.log(`[CLIP_VIDEO] Output filename will be: ${clipFilename}`);

    let downloadPromise = Promise.resolve(true); // Default to resolved if no download needed

    // --- Step 1: Determine video source and download if necessary ---
    if (inputFileName) {
        videoSourcePathForFFmpeg = path.join(HOST_DOWNLOADS_PATH_IN_CONTAINER, inputFileName);
        console.log(`[CLIP_VIDEO] Attempting to use local file: ${videoSourcePathForFFmpeg}`);
        try {
            await fsp.access(videoSourcePathForFFmpeg, fs.constants.F_OK);
            console.log(`[CLIP_VIDEO] Confirmed local file access: ${videoSourcePathForFFmpeg}`);
        } catch (err) {
            console.error(`[CLIP_VIDEO] Local file not found or not accessible: ${videoSourcePathForFFmpeg}`, err);
            return res.status(404).send(`Error: Local file ${inputFileName} not found or not accessible in the mapped directory.`);
        }
    } else if (sourceType && decodedIdentifier) {
        // This logic is for when inputFileName is NOT provided, so we download.
        tempInputDownloadPath = path.join(tempDir, `input_${uniqueId}.tmp`); // Base path for download
        videoSourcePathForFFmpeg = `${tempInputDownloadPath}.mp4`; // Expected final downloaded file for ffmpeg
        cleanupDownloadFiles = true; // Mark that these files will need cleanup
        console.log(`[CLIP_VIDEO] Temp download path: ${tempInputDownloadPath}, FFmpeg will use: ${videoSourcePathForFFmpeg}`);

        if (sourceType === 'external_url') {
            console.log(`[CLIP_VIDEO] Source is external URL: ${decodedIdentifier.substring(0, 60)}...`);
            if (decodedIdentifier.includes('youtube.com/') || decodedIdentifier.includes('youtu.be/')) {
                downloadPromise = new Promise((resolve, reject) => {
                    console.log(`[CLIP_VIDEO] Downloading YouTube URL to ${tempInputDownloadPath} using yt-dlp...`);
                    const ytDlpArgs = [
                        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                        '--no-playlist',
                        '-o', tempInputDownloadPath, // yt-dlp appends .mp4 or merges to this with .mp4
                        decodedIdentifier
                    ];
                    const ytDlpClip = spawn('yt-dlp', ytDlpArgs);
                    ytDlpClip.stdout.on('data', (data) => { console.log(`[CLIP_VIDEO] yt-dlp stdout: ${data}`); });
                    ytDlpClip.stderr.on('data', (data) => { console.error(`[CLIP_VIDEO] yt-dlp stderr: ${data}`); });
                    ytDlpClip.on('close', (code) => {
                        if (code === 0) {
                            // Verify the expected output file (e.g., input_uniqueId.tmp.mp4) exists
                            fs.access(videoSourcePathForFFmpeg, fs.constants.F_OK, (err) => {
                                if (err) {
                                    // Sometimes yt-dlp might output directly to tempInputDownloadPath if it's already mp4
                                    // and doesn't add '.mp4'. Check that possibility.
                                    fs.access(tempInputDownloadPath, fs.constants.F_OK, (errDirect) => {
                                        if (errDirect) {
                                            reject(new Error(`yt-dlp download succeeded but output file ${videoSourcePathForFFmpeg} or ${tempInputDownloadPath} not found.`));
                                        } else {
                                            videoSourcePathForFFmpeg = tempInputDownloadPath; // Adjust if direct match
                                            console.log(`[CLIP_VIDEO] yt-dlp output directly to ${videoSourcePathForFFmpeg}`);
                                            resolve(true);
                                        }
                                    });
                                } else {
                                    resolve(true);
                                }
                            });
                        } else {
                            reject(new Error(`yt-dlp download failed with code ${code}`));
                        }
                    });
                    ytDlpClip.on('error', (err) => { reject(new Error(`Failed to spawn yt-dlp for download: ${err.message}`)); });
                });
            } else {
                downloadPromise = new Promise((resolve, reject) => {
                    console.log(`[CLIP_VIDEO] Downloading direct URL to ${videoSourcePathForFFmpeg}...`); // Download directly to the .mp4 suffixed path
                    const fileStream = fs.createWriteStream(videoSourcePathForFFmpeg);
                    const request = https.get(decodedIdentifier, (response) => {
                        if (response.statusCode !== 200) {
                            fileStream.close();
                            fs.unlink(videoSourcePathForFFmpeg, () => {}); // Attempt cleanup
                            return reject(new Error(`Failed to download direct URL: Status Code ${response.statusCode}`));
                        }
                        response.pipe(fileStream);
                        fileStream.on('finish', () => { fileStream.close(); resolve(true); });
                    }).on('error', (err) => {
                        fs.unlink(videoSourcePathForFFmpeg, () => {}); // Attempt cleanup
                        reject(err);
                    });
                });
            }
        } else if (sourceType === 'supabase') {
            if (!supabase) return res.status(500).json({ error: "Supabase client not configured on server." });
            downloadPromise = new Promise(async (resolve, reject) => {
                 console.log(`[CLIP_VIDEO] Downloading Supabase file ${decodedIdentifier} to ${videoSourcePathForFFmpeg}...`); // Download to .mp4 suffixed path
                try {
                    const { data: urlData, error: urlError } = await supabase.storage
                        .from('raw-videos')
                        .createSignedUrl(decodedIdentifier, 60);
                    if (urlError) throw urlError;
                    if (!urlData?.signedUrl) throw new Error("Failed to get Supabase signed URL");

                    const fileStream = fs.createWriteStream(videoSourcePathForFFmpeg);
                    https.get(urlData.signedUrl, (response) => {
                        if (response.statusCode !== 200) {
                            fileStream.close();
                            fs.unlink(videoSourcePathForFFmpeg, () => {}); // Attempt cleanup
                             return reject(new Error(`Failed to download from Supabase URL: Status Code ${response.statusCode}`));
                        }
                        response.pipe(fileStream);
                        fileStream.on('finish', () => { fileStream.close(); resolve(true); });
                    }).on('error', (err) => {
                        fs.unlink(videoSourcePathForFFmpeg, () => {}); // Attempt cleanup
                        reject(err);
                    });
                } catch (err) {
                    reject(new Error(`Supabase download failed: ${err.message}`));
                }
            });
        } else {
            return res.status(400).json({ error: `Invalid sourceType: ${sourceType} when inputFileName is not provided.` });
        }
    } else {
        // This case should have been caught by earlier validation
        return res.status(400).json({ error: "Invalid request parameters." });
    }

    // --- Step 2: Execute download (if any) and then run FFmpeg --- 
    try {
        await downloadPromise;
        console.log(`[CLIP_VIDEO] Download successful. Starting FFmpeg clipping...`);

        // Set headers for streaming MP4 and the custom filename header
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('X-Clip-Filename', clipFilename);

        const ffmpegArgs = [
            '-i', videoSourcePathForFFmpeg,    // Use the determined source path
            '-ss', String(start),
            '-to', String(end),
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero', // Handle potential timestamp issues
            '-movflags', 'frag_keyframe+empty_moov', // Optimize for streaming
            '-f', 'mp4',             // Output format MP4
            'pipe:1'                 // Output to stdout
        ];
        
        const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

        // Pipe ffmpeg output to HTTP response
        ffmpegProcess.stdout.pipe(res);

        // Log stderr
        ffmpegProcess.stderr.on('data', (data) => {
            console.error(`[CLIP_VIDEO] ffmpeg stderr: ${data}`);
        });

        // Handle ffmpeg exit
        ffmpegProcess.on('close', async (code) => { // Make this async for cleanup
             console.log(`[CLIP_VIDEO] FFmpeg process finished with code ${code}`);
             // Clean up the temporary input file only if it was a download
             if (cleanupDownloadFiles) {
                 // Files to clean: videoSourcePathForFFmpeg (e.g., input_id.tmp.mp4)
                 // and potentially tempInputDownloadPath (e.g., input_id.tmp) if yt-dlp left it.
                 const filesToAttemptDelete = [videoSourcePathForFFmpeg];
                 if (tempInputDownloadPath && videoSourcePathForFFmpeg !== tempInputDownloadPath) { // tempInputDownloadPath is the base name for yt-dlp if it differs
                    filesToAttemptDelete.push(tempInputDownloadPath);
                 }
                 // Additional cleanup for other potential yt-dlp artifacts if needed, e.g., .webm if format was different
                 // For now, focusing on the primary target and its base.
                 for (const fileToDelete of filesToAttemptDelete) {
                    try {
                        if (fileToDelete && await fsp.stat(fileToDelete).then(() => true).catch(() => false)) {
                             await fsp.unlink(fileToDelete);
                             console.log(`[CLIP_VIDEO] Deleted temp file: ${fileToDelete}`);
                        }
                    } catch (err) {
                         console.error(`[CLIP_VIDEO] Error deleting temp file ${fileToDelete}:`, err);
                    }
                 }
             }
             if (code !== 0) {
                 console.error(`[CLIP_VIDEO] FFmpeg failed.`);
                 if (!res.headersSent) {
                     res.status(500).json({ error: `FFmpeg clipping failed with code ${code}. Check server logs.` });
                 }
             } else {
                 console.log(`[CLIP_VIDEO] Clipping successful for ${clipFilename}.`);
             }
             if (!res.writableEnded) {
                 res.end(); // Ensure response ends
             }
        });

        // Handle spawn error
        ffmpegProcess.on('error', async (spawnError) => { // Make this async for cleanup
            console.error("[CLIP_VIDEO] Failed to spawn ffmpeg process:", spawnError);
            if (cleanupDownloadFiles) {
                const filesToAttemptDelete = [videoSourcePathForFFmpeg];
                if (tempInputDownloadPath && videoSourcePathForFFmpeg !== tempInputDownloadPath) {
                   filesToAttemptDelete.push(tempInputDownloadPath);
                }
                for (const fileToDelete of filesToAttemptDelete) {
                    try {
                        if (fileToDelete && await fsp.stat(fileToDelete).then(() => true).catch(() => false)) {
                            await fsp.unlink(fileToDelete);
                            console.log(`[CLIP_VIDEO] Deleted temp file after spawn error: ${fileToDelete}`);
                        }
                    } catch (err) {
                        console.error(`[CLIP_VIDEO] Error deleting temp file ${fileToDelete} after spawn error:`, err);
                    }
                }
            }
            if (!res.headersSent) {
                res.status(500).json({ error: "Server error: Failed to start clipping process." });
            }
        });

    } catch (error) { // This is the outer try-catch for downloadPromise
        console.error(`[CLIP_VIDEO] Error during download or clipping setup: ${error.message}`);
        if (cleanupDownloadFiles) {
            const filesToAttemptDelete = [videoSourcePathForFFmpeg];
            if (tempInputDownloadPath && videoSourcePathForFFmpeg !== tempInputDownloadPath) {
               filesToAttemptDelete.push(tempInputDownloadPath);
            }
            for (const fileToDelete of filesToAttemptDelete) {
                try {
                    if (fileToDelete && await fsp.stat(fileToDelete).then(() => true).catch(() => false)) {
                        await fsp.unlink(fileToDelete);
                        console.log(`[CLIP_VIDEO] Deleted temp file after error: ${fileToDelete}`);
                    }
                } catch (err) {
                    // Don't log ENOENT (file not found) too loudly as download might have failed before creating it
                    if (err.code !== 'ENOENT') {
                        console.error(`[CLIP_VIDEO] Error deleting temp file ${fileToDelete} after error:`, err);
                    }
                }
            }
        }
        if (!res.headersSent) {
            res.status(500).json({ error: `Processing failed: ${error.message}` });
        }
    }
});
// --- END: /api/clip-video Route ---

app.listen(port, () => {
  console.log(`[SERVER] Server listening on port ${port}`);
  console.log(`[SERVER] To test YouTube download, access: http://localhost:${port}/api/download-video?sourceType=external_url&identifier=YOUR_YOUTUBE_URL`);
  console.log(`[SERVER] To test health check, access: http://localhost:${port}/api/hello`);
}); 