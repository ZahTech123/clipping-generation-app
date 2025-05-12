// supabase/functions/trim-video/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- FFmpeg.wasm specific imports and setup (Conceptual) ---
// This part is highly dependent on how you bundle/host ffmpeg.wasm files for Deno.
// import { FFmpeg } from '@ffmpeg/ffmpeg'; // This is the Node/browser package
// import { fetchFile, toBlobURL } from '@ffmpeg/util';
// let ffmpeg: FFmpeg | null = null; // Singleton instance

// async function getFFmpeg(): Promise<FFmpeg> {
//   if (ffmpeg && ffmpeg.loaded) return ffmpeg;
//   ffmpeg = new FFmpeg();
//   ffmpeg.on('log', ({ message }) => console.log(`FFMPEG Log: ${message}`));
//   // You need to provide the coreURL, wasmURL, and workerURL
//   // These URLs must point to where these files are hosted, accessible by the Edge Function.
//   // This might involve bundling them or serving them from Supabase Storage.
//   // const CORE_URL = await toBlobURL('/path/to/ffmpeg-core.js', 'text/javascript');
//   // const WASM_URL = await toBlobURL('/path/to/ffmpeg-core.wasm', 'application/wasm');
//   // const WORKER_URL = await toBlobURL('/path/to/ffmpeg-core.worker.js', 'text/javascript'); // If using worker
//   // await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL /*, workerURL: WORKER_URL */ });
//   console.log("FFmpeg loaded (simulated for now).");
//   return ffmpeg;
// }
// --- End FFmpeg.wasm conceptual setup ---

const formatTimestampSrt = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor((totalSeconds * 1000) % 1000); // Ensure milliseconds calculation is correct
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
};


serve(async (req: Request) => {
  console.log("'trim-video' function invoked.");
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { videoPath, highlight } = await req.json();
    console.log("Request body:", { videoPath, highlight });

    if (!videoPath || !highlight || !highlight.transcription) {
      console.error("Missing videoPath or highlight data (incl. transcription).");
      return new Response(JSON.stringify({ error: 'Missing videoPath or highlight data' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const { start, end, transcription, description } = highlight;
    console.log(`Trimming video '${videoPath}' from ${start}s to ${end}s. Description: ${description}`);

    const supabaseAdminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // --- 1. Download the raw video from Supabase Storage ---
    console.log(`Downloading original video from Supabase Storage: ${videoPath}`);
    const { data: videoBlob, error: downloadError } = await supabaseAdminClient.storage
      .from('raw-videos') // Assuming original video is in 'raw-videos' (or adjust as needed)
      .download(videoPath);

    if (downloadError) {
      console.error("Failed to download video for trimming:", downloadError);
      throw downloadError;
    }
    if (!videoBlob) throw new Error('Downloaded video blob is null.');
    const videoBuffer = await videoBlob.arrayBuffer();
    console.log(`Video downloaded, size: ${(videoBuffer.byteLength / (1024*1024)).toFixed(2)} MB`);

    // --- 2. FFmpeg Processing (using ffmpeg.wasm conceptually) ---
    // const ffmpegInstance = await getFFmpeg(); // Load FFmpeg
    const inputFileName = 'input.mp4';
    const subtitlesFileName = `subs_${start}_${end}.srt`;
    const outputFileName = `clip_${description.replace(/\s+/g, '_')}_${start}_${end}_${Date.now()}.mp4`;

    // Create SRT content
    const segmentDuration = end - start;
    const srtContent = `1\n${formatTimestampSrt(0)} --> ${formatTimestampSrt(segmentDuration)}\n${transcription}\n\n`;
    console.log("Generated SRT content:", srtContent);

    // --- Simulate FFmpeg execution ---
    // In a real ffmpeg.wasm scenario:
    // await ffmpegInstance.writeFile(inputFileName, new Uint8Array(videoBuffer));
    // await ffmpegInstance.writeFile(subtitlesFileName, srtContent);
    // console.log("Executing FFmpeg command (simulated)...");
    // const ffmpegCommand = [
    //   '-i', inputFileName,
    //   '-ss', String(start - start), // Relative start time for the segment
    //   '-to', String(segmentDuration),
    //   '-vf', `subtitles=${subtitlesFileName}:force_style='FontName=Arial,FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=1,Outline=1,Shadow=0.5,MarginV=20'`,
    //   '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', // Adjust encoding params
    //   '-c:a', 'aac', '-b:a', '128k',
    //   outputFileName
    // ];
    // console.log("FFMPEG Command:", ffmpegCommand.join(" "));
    // await ffmpegInstance.exec(ffmpegCommand);
    // const outputData = await ffmpegInstance.readFile(outputFileName);
    // console.log(`FFmpeg processing complete (simulated). Output size: ${(outputData.byteLength / (1024*1024)).toFixed(2)} MB`);
    // --- End FFmpeg simulation ---

    // For this example, let's just return a small part of the original as "processed"
    // This avoids the full ffmpeg.wasm setup in this snippet.
    const mockProcessedVideoPortion = new Uint8Array(videoBuffer.slice(0, Math.min(videoBuffer.byteLength, 1 * 1024 * 1024))); // Max 1MB mock
    console.warn("FFMPEG EXECUTION IS SIMULATED. Actual trimming and subtitling require ffmpeg.wasm or similar setup in the Edge Function environment.");

    // --- 3. Store final clip in Supabase Storage ---
    console.log(`Uploading processed clip to Supabase Storage: processed-clips/${outputFileName}`);
    const { data: clipUploadData, error: clipUploadError } = await supabaseAdminClient.storage
      .from('processed-clips')
      .upload(outputFileName, mockProcessedVideoPortion, { // Use `outputData` in real scenario
        contentType: 'video/mp4',
        upsert: false,
      });

    if (clipUploadError) {
      console.error("Failed to upload processed clip:", clipUploadError);
      throw clipUploadError;
    }

    const { data: publicClipUrlData } = supabaseAdminClient.storage
      .from('processed-clips')
      .getPublicUrl(outputFileName);

    const clipUrl = publicClipUrlData.publicUrl;
    console.log(`Clip uploaded successfully. URL: ${clipUrl}`);

    // Clean up in-memory files if using ffmpeg.wasm
    // await ffmpegInstance.deleteFile(inputFileName);
    // await ffmpegInstance.deleteFile(subtitlesFileName);
    // await ffmpegInstance.deleteFile(outputFileName);

    return new Response(JSON.stringify({
      clipUrl,
      description,
      transcription,
      start,
      end,
      message: "Clip trimmed and subtitled successfully (simulated FFmpeg)."
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in trim-video function:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});