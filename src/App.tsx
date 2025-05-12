import React, { useState, useRef } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import './App.css'; // Make sure you have some basic styling

// Initialize Supabase Client (Replace with your actual URL and Anon Key)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase URL and Anon Key are required. Please set them in your .env file (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)");
  alert("Supabase URL and Anon Key are required. Please check console and .env settings.");
}
// @ts-ignore createClient can accept undefined but we want to ensure they are set.
const supabase: SupabaseClient = createClient(supabaseUrl!, supabaseAnonKey!);

interface Clip {
  id: string;
  startTime: number; // Changed from 'start' to match Gemini's expected output from prompt
  endTime: number;   // Changed from 'end' to match Gemini's expected output from prompt
  description: string;
  transcription: string;
  clipUrl?: string; // URL to the processed clip
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

interface InitialClipData { // Structure from Gemini
  startTime: number;
  endTime: number;
  description: string;
  transcription: string;
}

function App() {
  const [videoUrlInput, setVideoUrlInput] = useState<string>(''); // Renamed from youtubeUrl for clarity
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputType, setInputType] = useState<'url' | 'upload'>('url');

  const addLog = (message: string) => {
    console.log(message);
    setLogs(prevLogs => [new Date().toLocaleTimeString() + ': ' + message, ...prevLogs].slice(0, 100));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      // Example: Limit file size to 900MB (adjust as needed by Supabase/FFMPEG function)
      if (file.size > 900 * 1024 * 1024) { 
        addLog(`Error: File size exceeds 900MB limit. Selected file is ${(file.size / (1024 * 1024)).toFixed(2)} MB`);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setSelectedFile(file);
      addLog(`File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    } else {
      setSelectedFile(null);
    }
  };

  const handleSubmit = async () => {
    setProcessing(true);
    setLogs([]);
    setClips([]);
    addLog('Starting video processing flow...');

    let videoIdentifierForFunction: { type: 'url', value: string } | { type: 'storagePath', value: string };

    try {
      if (inputType === 'url' && videoUrlInput) {
        addLog(`Processing Video URL: ${videoUrlInput}`);
        videoIdentifierForFunction = { type: 'url', value: videoUrlInput };
      } else if (inputType === 'upload' && selectedFile) {
        addLog(`Uploading file: ${selectedFile.name}`);
        const fileExt = selectedFile.name.split('.').pop();
        const sanitizedFileName = selectedFile.name.substring(0, selectedFile.name.length - (fileExt ? fileExt.length+1 : 0)).replace(/[^a-zA-Z0-9_.-]/g, '_');
        const fileName = `uploads/${Date.now()}_${sanitizedFileName}${fileExt ? '.' + fileExt : ''}`;

        addLog(`Attempting to upload ${selectedFile.name} to bucket 'raw-videos' at path: ${fileName}`);
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('raw-videos') // Your bucket for raw uploads
          .upload(fileName, selectedFile, {
            cacheControl: '3600',
            upsert: false, // Set to true if you want to allow overwriting
            contentType: selectedFile.type || 'video/mp4', // Provide a default if type is missing
          });

        if (uploadError) {
          addLog(`Supabase upload error: ${uploadError.message}`);
          throw new Error(`Supabase upload error: ${uploadError.message}`);
        }
        addLog(`File uploaded to Supabase Storage: ${uploadData.path}`);
        videoIdentifierForFunction = { type: 'storagePath', value: uploadData.path };
      } else {
        addLog('Error: No Video URL provided or no file selected.');
        setProcessing(false);
        return;
      }

      addLog(`Invoking 'process-video' Edge Function with ${videoIdentifierForFunction.type === 'url' ? 'videoUrl' : 'uploadedVideoPath'}`);
      const functionPayload = videoIdentifierForFunction.type === 'url'
        ? { videoUrl: videoIdentifierForFunction.value }
        : { uploadedVideoPath: videoIdentifierForFunction.value };
      addLog(`'process-video' function payload: ${JSON.stringify(functionPayload)}`);

      const { data: processResponse, error: processError } = await supabase.functions.invoke<{
        message: string;
        initialClips: InitialClipData[]; // Typed to match expected Gemini output
        processedVideoDetails: { pathOrUrl: string; sourceType: 'supabase' | 'external_url' };
      }>(
        'process-video',
        { body: functionPayload }
      );

      addLog(`'process-video' function raw response: ${JSON.stringify(processResponse)}`);
      addLog(`'process-video' function raw error: ${JSON.stringify(processError)}`);

      if (processError) {
        let detailedErrorMessage = processError.message;
        // @ts-ignore Supabase error context can be complex
        if (processError.context && typeof processError.context.body === 'string') {
            try { // @ts-ignore
                const errorBody = JSON.parse(processError.context.body);
                detailedErrorMessage += ` Server detail: ${errorBody.error_message || errorBody.error || JSON.stringify(errorBody)}`;
            } catch (e) { /* ignore */ }
        // @ts-ignore
        } else if (processError.context && processError.context.status) { // @ts-ignore
             detailedErrorMessage += ` (Status: ${processError.context.status})`;
        }
        throw new Error(`'process-video' Edge Function error: ${detailedErrorMessage}`);
      }

      if (!processResponse || !processResponse.initialClips || !processResponse.processedVideoDetails) {
        console.error("Function response details:", processResponse);
        throw new Error("'process-video' Edge Function did not return expected 'initialClips' or 'processedVideoDetails' data. Check function logs.");
      }

      addLog("'process-video' function completed. Received potential clips metadata.");
      const initialClipsData: InitialClipData[] = processResponse.initialClips;
      const clipsWithStatus: Clip[] = initialClipsData.map((clip, index) => ({
        ...clip, // startTime, endTime, description, transcription come from Gemini
        id: `clip-${Date.now()}-${index}`,
        status: 'pending',
      }));
      setClips(clipsWithStatus);

      // --- Now, for each clip, invoke the 'trim-video' Edge Function ---
      addLog(`Starting to process ${clipsWithStatus.length} potential clips sequentially...`);
      const finalClips: Clip[] = [];
      for (const clipData of clipsWithStatus) {
        // Update UI for the current clip being processed
        setClips(prev => prev.map(c => c.id === clipData.id ? { ...c, status: 'processing' } : c));
        try {
          addLog(`Invoking 'trim-video' for clip: "${clipData.description}" (Start: ${clipData.startTime}s, End: ${clipData.endTime}s)`);

          const trimFunctionPayload = {
            videoIdentifier: processResponse.processedVideoDetails.pathOrUrl,
            sourceType: processResponse.processedVideoDetails.sourceType,
            highlight: {
              start: clipData.startTime, // Use startTime
              end: clipData.endTime,     // Use endTime
              transcription: clipData.transcription,
              description: clipData.description,
            },
          };
          addLog(`'trim-video' function payload: ${JSON.stringify(trimFunctionPayload)}`);

          const { data: trimResponse, error: trimError } = await supabase.functions.invoke<{ clipUrl: string }>(
            'trim-video',
            { body: trimFunctionPayload }
          );
          
          addLog(`'trim-video' raw response for "${clipData.description}": ${JSON.stringify(trimResponse)}`);
          addLog(`'trim-video' raw error for "${clipData.description}": ${JSON.stringify(trimError)}`);

          if (trimError) {
            let detailedTrimErrorMessage = trimError.message;
            // @ts-ignore
            if (trimError.context && typeof trimError.context.body === 'string') { // @ts-ignore
                try { const errorBody = JSON.parse(trimError.context.body); detailedTrimErrorMessage += ` Server detail: ${errorBody.error_message || errorBody.error || JSON.stringify(errorBody)}`; } catch (e) { /* Ignore */ }
            // @ts-ignore
            } else if (trimError.context && trimError.context.status) { detailedTrimErrorMessage += ` (Status: ${trimError.context.status})`; }
            throw new Error(`'trim-video' for "${clipData.description}" failed: ${detailedTrimErrorMessage}`);
          }

          if (!trimResponse || !trimResponse.clipUrl) {
            throw new Error(`'trim-video' for "${clipData.description}" did not return clipUrl.`);
          }

          addLog(`Clip processed: "${clipData.description}", URL: ${trimResponse.clipUrl}`);
          const completedClip = { ...clipData, clipUrl: trimResponse.clipUrl, status: 'completed' as const };
          finalClips.push(completedClip);
          setClips(prev => prev.map(c => c.id === clipData.id ? completedClip : c));

        } catch (trimClipError: any) {
          addLog(`Error processing clip "${clipData.description}": ${trimClipError.message}`);
          const failedClip = { ...clipData, status: 'failed' as const, error: trimClipError.message };
          finalClips.push(failedClip);
          setClips(prev => prev.map(c => c.id === clipData.id ? failedClip : c));
        }
      }
      addLog("All clips processing attempted.");

    } catch (error: any) {
      addLog(`Error in processing flow: ${error.message}`);
      console.error("Full error object in processing flow:", error);
      setClips(prev => prev.map(c => 
        (c.status === 'pending' || c.status === 'processing') 
          ? { ...c, status: 'failed', error: "Main process failed or was interrupted. Check logs." } 
          : c
      ));
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSelectedFile(null);
      // setVideoUrlInput(''); // Optionally clear
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Minimal Video Clipping Tool</h1>
        <p>Powered by Supabase & Gemini</p>
      </header>
      <main>
        <div className="input-section card">
          <h2>1. Provide Video</h2>
          <div className="input-type-selector">
            <label>
              <input type="radio" name="inputType" value="url" checked={inputType === 'url'} onChange={() => setInputType('url')} disabled={processing} />
              Video URL (e.g., direct MP4, MOV link)
            </label>
            <label>
              <input type="radio" name="inputType" value="upload" checked={inputType === 'upload'} onChange={() => setInputType('upload')} disabled={processing} />
              Upload File (Max 900MB)
            </label>
          </div>

          {inputType === 'url' && (
            <input
              type="text"
              placeholder="Enter direct video URL (MP4, MOV, etc.)"
              value={videoUrlInput}
              onChange={(e) => setVideoUrlInput(e.target.value)}
              disabled={processing}
              style={{width: '90%', padding: '10px', margin: '10px 0'}}
            />
          )}
          {inputType === 'upload' && (
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              ref={fileInputRef}
              disabled={processing}
              style={{margin: '10px 0'}}
            />
          )}
          <button onClick={handleSubmit} disabled={processing || (inputType === 'url' && !videoUrlInput) || (inputType === 'upload' && !selectedFile)}>
            {processing ? 'Processing...' : 'Generate Clips'}
          </button>
        </div>

        <div className="results-section card">
          <h2>2. Processing Logs</h2>
          <div className="logs">
            {logs.length === 0 && !processing && <p>No logs yet. Submit a video to start.</p>}
            {logs.map((log, index) => (
              <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : ''}>{log}</p>
            ))}
          </div>
        </div>

        <div className="results-section card">
          <h2>3. Highlighted Clips</h2>
          {clips.length > 0 && (
            <ul className="clips-list">
              {clips.map((clip) => (
                <li key={clip.id} className={`clip-item status-${clip.status}`}>
                  <strong>Description:</strong> {clip.description} <br />
                  <strong>Timestamps:</strong> {clip.startTime}s - {clip.endTime}s <br />
                  <strong>Transcription:</strong> {clip.transcription || "N/A"} <br />
                  <strong>Status:</strong> <span className={`status-badge status-${clip.status}`}>{clip.status}</span>
                  {clip.clipUrl && (
                    <>
                      <br />
                      <a href={clip.clipUrl} target="_blank" rel="noopener noreferrer" className="download-link">
                        View/Download Clip
                      </a>
                    </>
                  )}
                  {clip.error && <p className="error-message">Error: {clip.error}</p>}
                </li>
              ))}
            </ul>
          )}
          {processing && clips.length === 0 && logs.length > 0 && <p>Analyzing video and identifying potential clips... This may take a few minutes for longer videos.</p>}
          {!processing && clips.length === 0 && logs.length > 0 && <p>Processing finished. If no clips were generated, the video might not have yielded suitable clips, or an error occurred during analysis. Please check logs.</p>}
        </div>
      </main>
    </div>
  );
}

export default App;