import React, { useState, useRef } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import './App.css';

// ... (Supabase client initialization remains the same) ...
// @ts-ignore createClient can accept undefined but we want to ensure they are set.
const supabase: SupabaseClient = createClient(supabaseUrl!, supabaseAnonKey!);


interface Clip {
  id: string;
  startTime: number;
  endTime: number;
  description: string;
  transcription: string;
  clipUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

interface InitialClipData {
  startTime: number;
  endTime: number;
  description: string;
  transcription: string;
}

// NEW: Interface for processed video details
interface ProcessedVideoDetails {
    pathOrUrl: string;
    sourceType: 'supabase' | 'external_url';
}

function App() {
  const [videoUrlInput, setVideoUrlInput] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputType, setInputType] = useState<'url' | 'upload'>('url');
  // NEW State: Store details of the video processed by the function
  const [processedVideoDetails, setProcessedVideoDetails] = useState<ProcessedVideoDetails | null>(null);
  // NEW State: Track if analysis is complete to show download button
  const [analysisComplete, setAnalysisComplete] = useState<boolean>(false);


  const addLog = (message: string) => {
    console.log(message);
    setLogs(prevLogs => [new Date().toLocaleTimeString() + ': ' + message, ...prevLogs].slice(0, 100));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // ... (file change logic remains the same) ...
    if (event.target.files && event.target.files[0]) {
        const file = event.target.files[0];
        if (file.size > 900 * 1024 * 1024) {
          addLog(`Error: File size exceeds 900MB limit. Selected file is ${(file.size / (1024 * 1024)).toFixed(2)} MB`);
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }
        setSelectedFile(file);
        setProcessedVideoDetails(null); // Clear previous processed details on new selection
        setAnalysisComplete(false);     // Reset analysis status
        addLog(`File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
      } else {
        setSelectedFile(null);
      }
  };

  // NEW: Handler for the download button
  const handleDownloadOriginal = () => {
    if (!processedVideoDetails) {
        addLog('Error: No processed video details available for download.');
        return;
    }
    addLog('Initiating download of original video...');
    const { pathOrUrl, sourceType } = processedVideoDetails;

    // Construct the URL for the Vercel download function
    const downloadApiUrl = `/api/download-video`;
    const params = new URLSearchParams({
        sourceType: sourceType,
        identifier: pathOrUrl, // Send the path or URL as 'identifier'
    });

    const fullDownloadUrl = `${downloadApiUrl}?${params.toString()}`;
    addLog(`Requesting download from: ${fullDownloadUrl}`);

    // Open the URL in a new tab/window - the Vercel function will handle the download trigger
    // Using window.location.href might work too, but new tab is often safer for downloads
    window.open(fullDownloadUrl, '_blank');

    // Alternatively, use window.location.href if you prefer staying in the same tab
    // window.location.href = fullDownloadUrl;
  };

  const handleSubmit = async () => {
    setProcessing(true);
    setLogs([]);
    setClips([]);
    setProcessedVideoDetails(null); // Clear previous details
    setAnalysisComplete(false);     // Reset analysis status
    addLog('Starting video processing flow...');

    let videoIdentifierForFunction: { type: 'url', value: string } | { type: 'storagePath', value: string };

    try {
      // ... (logic for determining videoIdentifierForFunction remains the same) ...
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
            upsert: false,
            contentType: selectedFile.type || 'video/mp4',
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
        initialClips: InitialClipData[];
        processedVideoDetails: ProcessedVideoDetails; // Use the interface
      }>(
        'process-video',
        { body: functionPayload }
      );

      addLog(`'process-video' function raw response: ${JSON.stringify(processResponse)}`);
      addLog(`'process-video' function raw error: ${JSON.stringify(processError)}`);

      if (processError) {
        // ... (error handling remains the same) ...
        let detailedErrorMessage = processError.message;
        // @ts-ignore
        if (processError.context && typeof processError.context.body === 'string') { try { const errorBody = JSON.parse(processError.context.body); detailedErrorMessage += ` Server detail: ${errorBody.error_message || errorBody.error || JSON.stringify(errorBody)}`; } catch (e) { /* ignore */ } }
        // @ts-ignore
        else if (processError.context && processError.context.status) { detailedErrorMessage += ` (Status: ${processError.context.status})`; }
        throw new Error(`'process-video' Edge Function error: ${detailedErrorMessage}`);
      }

      if (!processResponse || !processResponse.initialClips || !processResponse.processedVideoDetails) {
        console.error("Function response details:", processResponse);
        throw new Error("'process-video' Edge Function did not return expected 'initialClips' or 'processedVideoDetails' data. Check function logs.");
      }

      addLog("'process-video' function completed. Received potential clips metadata.");
      const initialClipsData: InitialClipData[] = processResponse.initialClips;
      const clipsWithStatus: Clip[] = initialClipsData.map((clip, index) => ({
        ...clip,
        id: `clip-${Date.now()}-${index}`,
        status: 'pending', // Keep as pending, we won't process them yet
      }));
      setClips(clipsWithStatus); // Show the potential clips identified
      setProcessedVideoDetails(processResponse.processedVideoDetails); // Store the details needed for download
      setAnalysisComplete(true); // Mark analysis as complete

      addLog("Analysis complete. Original video is ready for download.");
      addLog(`Video Source Type: ${processResponse.processedVideoDetails.sourceType}, Identifier: ${processResponse.processedVideoDetails.pathOrUrl}`);

      // --- !!! TEMPORARILY COMMENT OUT THE TRIM-VIDEO CALLS !!! ---
      /*
      addLog(`Starting to process ${clipsWithStatus.length} potential clips sequentially...`);
      const finalClips: Clip[] = [];
      for (const clipData of clipsWithStatus) {
        // ... (rest of the trim-video loop) ...
      }
      addLog("All clips processing attempted.");
      */
      // --- End of commented out section ---

    } catch (error: any) {
      addLog(`Error in processing flow: ${error.message}`);
      console.error("Full error object in processing flow:", error);
       setAnalysisComplete(false); // Ensure analysis complete is false on error
      setClips(prev => prev.map(c =>
        (c.status === 'pending' || c.status === 'processing')
          ? { ...c, status: 'failed', error: "Main process failed or was interrupted. Check logs." }
          : c
      ));
    } finally {
      setProcessing(false);
      // Don't clear inputs here, user might want to download
      // if (fileInputRef.current) fileInputRef.current.value = "";
      // setSelectedFile(null);
      // setVideoUrlInput('');
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
          {/* ... (input type selector, URL input, file input remain the same) ... */}
           <div className="input-type-selector">
             <label>
               <input type="radio" name="inputType" value="url" checked={inputType === 'url'} onChange={() => { setInputType('url'); setProcessedVideoDetails(null); setAnalysisComplete(false); }} disabled={processing} />
               Video URL (e.g., YouTube, direct MP4 link)
             </label>
             <label>
               <input type="radio" name="inputType" value="upload" checked={inputType === 'upload'} onChange={() => { setInputType('upload'); setProcessedVideoDetails(null); setAnalysisComplete(false); }} disabled={processing} />
               Upload File (Max 900MB)
             </label>
           </div>

           {inputType === 'url' && (
             <input
               type="text"
               placeholder="Enter YouTube or direct video URL (MP4, MOV, etc.)"
               value={videoUrlInput}
               onChange={(e) => { setVideoUrlInput(e.target.value); setProcessedVideoDetails(null); setAnalysisComplete(false); }}
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
            {processing ? 'Analyzing...' : 'Analyze Video'} {/* Changed button text */}
          </button>
        </div>

        {/* NEW: Download Section */}
        {analysisComplete && processedVideoDetails && !processing && (
            <div className="download-section card">
                <h2>2. Download Original</h2>
                <p>Analysis complete. You can now download the original video.</p>
                <button onClick={handleDownloadOriginal}>
                    Download Original Video
                </button>
                <p style={{fontSize: '0.8em', marginTop: '10px'}}>
                   Source: {processedVideoDetails.sourceType} <br/>
                   Identifier: {processedVideoDetails.pathOrUrl.length > 60 ? processedVideoDetails.pathOrUrl.substring(0, 60) + '...' : processedVideoDetails.pathOrUrl}
                </p>
            </div>
        )}

        <div className="results-section card">
          {/* Adjusted section numbering */}
          <h2>{analysisComplete && processedVideoDetails ? '3.' : '2.'} Processing Logs</h2>
          <div className="logs">
            {logs.length === 0 && !processing && <p>No logs yet. Submit a video to start analysis.</p>}
            {logs.map((log, index) => (
              <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : ''}>{log}</p>
            ))}
          </div>
        </div>

        <div className="results-section card">
           {/* Adjusted section numbering */}
          <h2>{analysisComplete && processedVideoDetails ? '4.' : '3.'} Potential Clips Identified</h2>
          {clips.length > 0 && (
            <ul className="clips-list">
              {clips.map((clip) => (
                // Keep displaying clips, but status will remain 'pending'
                <li key={clip.id} className={`clip-item status-${clip.status}`}>
                  <strong>Description:</strong> {clip.description} <br />
                  <strong>Timestamps:</strong> {clip.startTime}s - {clip.endTime}s <br />
                  <strong>Transcription:</strong> {clip.transcription || "N/A"} <br />
                  <strong>Status:</strong> <span className={`status-badge status-${clip.status}`}>{clip.status}</span>
                  {/* No download link for clips yet */}
                  {clip.error && <p className="error-message">Error: {clip.error}</p>}
                </li>
              ))}
            </ul>
          )}
          {processing && logs.length > 0 && <p>Analyzing video and identifying potential clips...</p>}
          {!processing && analysisComplete && clips.length === 0 && <p>Analysis finished, but no suitable clips were identified in the video.</p>}
          {!processing && !analysisComplete && logs.length > 0 && <p>Analysis failed. Please check logs.</p>}
        </div>
      </main>
    </div>
  );
}

export default App;