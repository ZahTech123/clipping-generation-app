import React, { useState, useRef } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import './App.css'; // Make sure you have some basic styling

// --- START: Correct Supabase Initialization ---
// Initialize Supabase Client using environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Check if the environment variables are loaded
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("CRITICAL ERROR: Supabase URL and Anon Key are required. Check your .env file (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) and ensure the dev server was restarted after changes.");
  // You might want to display an error state in the UI instead of alert
  alert("Application cannot start: Supabase configuration is missing. Check console and .env settings.");
  // Optionally, throw an error or return a component indicating the configuration error
  // For a production app, you'd handle this more gracefully than an alert.
}

// Create the Supabase client instance
// The non-null assertion (!) is used because the check above should catch undefined cases.
// If they are still undefined here, it's a critical setup issue.
const supabase: SupabaseClient = createClient(supabaseUrl!, supabaseAnonKey!);
// --- END: Correct Supabase Initialization ---


// --- Interfaces ---
interface Clip {
  id: string;
  startTime: number;
  endTime: number;
  description: string;
  transcription: string;
  clipUrl?: string; // URL to the processed/trimmed clip (not used currently as trimming is off)
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

interface InitialClipData { // Structure expected from Gemini via 'process-video'
  startTime: number;
  endTime: number;
  description: string;
  transcription: string;
}

interface ProcessedVideoDetails { // Details of the video source after 'process-video'
    pathOrUrl: string;
    sourceType: 'supabase' | 'external_url';
}
// --- End Interfaces ---


// --- App Component ---
function App() {
  // --- State Variables ---
  const [videoUrlInput, setVideoUrlInput] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState<boolean>(false); // True when any async operation is in progress
  const [logs, setLogs] = useState<string[]>([]);
  const [clips, setClips] = useState<Clip[]>([]); // Stores clips identified by Gemini
  const fileInputRef = useRef<HTMLInputElement>(null); // Ref for the file input element
  const [inputType, setInputType] = useState<'url' | 'upload'>('url'); // To switch between URL and upload
  const [processedVideoDetails, setProcessedVideoDetails] = useState<ProcessedVideoDetails | null>(null); // Stores info needed for download
  const [analysisComplete, setAnalysisComplete] = useState<boolean>(false); // Tracks if initial analysis is done
  // --- End State Variables ---

  // Helper to add messages to the log UI
  const addLog = (message: string) => {
    console.log(message); // Also log to browser console
    setLogs(prevLogs => [new Date().toLocaleTimeString() + ': ' + message, ...prevLogs].slice(0, 100)); // Keep last 100 logs
  };

  // Handles file selection from the input
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      // Example file size limit (adjust as needed)
      if (file.size > 900 * 1024 * 1024) {
        addLog(`Error: File size exceeds 900MB limit. Selected file is ${(file.size / (1024 * 1024)).toFixed(2)} MB`);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = ""; // Reset file input
        return;
      }
      setSelectedFile(file);
      // Reset states related to a previous analysis when a new file is selected
      setProcessedVideoDetails(null);
      setAnalysisComplete(false);
      setClips([]);
      addLog(`File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    } else {
      setSelectedFile(null); // No file selected or selection cancelled
    }
  };

  // Handles the "Download Original Video" button click
  const handleDownloadOriginal = () => {
    if (!processedVideoDetails) {
        addLog('Error: No processed video details available for download. Please analyze a video first.');
        return;
    }
    addLog('Initiating download of the original analyzed video...');
    const { pathOrUrl, sourceType } = processedVideoDetails;

    // Construct the URL for the Vercel serverless function that handles downloads
    const downloadApiUrl = `/api/download-video`; // Relative path to the API route
    const params = new URLSearchParams({
        sourceType: sourceType,
        identifier: pathOrUrl, // The URL or Supabase path of the video
    });

    const fullDownloadUrl = `${downloadApiUrl}?${params.toString()}`;
    addLog(`Requesting download from Vercel function: ${fullDownloadUrl}`);

    // Open the URL in a new tab/window; the Vercel function will set headers to trigger download
    window.open(fullDownloadUrl, '_blank');
  };

  // Main handler for submitting the video for analysis
  const handleSubmit = async () => {
    setProcessing(true);
    setLogs([]); // Clear previous logs
    setClips([]); // Clear previous clips
    setProcessedVideoDetails(null); // Clear previous video details
    setAnalysisComplete(false);
    addLog('Starting video analysis flow...');

    let videoIdentifierForFunction: { type: 'url', value: string } | { type: 'storagePath', value: string };

    try {
      // --- 1. Determine Video Source and Prepare for Function Call ---
      if (inputType === 'url' && videoUrlInput) {
        if (!videoUrlInput.trim()) {
            addLog('Error: Video URL cannot be empty.');
            setProcessing(false);
            return;
        }
        addLog(`Analyzing Video URL: ${videoUrlInput}`);
        videoIdentifierForFunction = { type: 'url', value: videoUrlInput };
      } else if (inputType === 'upload' && selectedFile) {
        addLog(`Uploading file for analysis: ${selectedFile.name}`);
        const fileExt = selectedFile.name.split('.').pop()?.toLowerCase() || '';
        const baseFileName = selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.') > -1 ? selectedFile.name.lastIndexOf('.') : selectedFile.name.length);
        const sanitizedFileName = baseFileName.replace(/[^a-zA-Z0-9_.-]/g, '_'); // Sanitize
        const timestamp = Date.now();
        // Construct a unique path in Supabase storage
        const supabasePath = `uploads/${timestamp}_${sanitizedFileName}${fileExt ? '.' + fileExt : ''}`;

        addLog(`Attempting to upload to Supabase bucket 'raw-videos' at path: ${supabasePath}`);
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('raw-videos') // Ensure this is your target bucket
          .upload(supabasePath, selectedFile, {
            cacheControl: '3600', // Cache for 1 hour
            upsert: false,       // Don't overwrite if a file with the exact same path exists
            contentType: selectedFile.type || 'application/octet-stream', // Provide content type
          });

        if (uploadError) {
          addLog(`Supabase upload error: ${uploadError.message}`);
          throw new Error(`Supabase upload failed: ${uploadError.message}`);
        }
        if (!uploadData || !uploadData.path) {
           addLog(`Supabase upload error: No path returned after upload. This should not happen.`);
           throw new Error(`Supabase upload failed: No path returned from storage.`);
        }
        addLog(`File uploaded successfully to Supabase Storage: ${uploadData.path}`);
        videoIdentifierForFunction = { type: 'storagePath', value: uploadData.path };
      } else {
        addLog('Error: No Video URL provided or no file selected for analysis.');
        setProcessing(false);
        return;
      }

      // --- 2. Invoke 'process-video' Edge Function ---
      addLog(`Invoking 'process-video' Edge Function...`);
      const functionPayload = videoIdentifierForFunction.type === 'url'
        ? { videoUrl: videoIdentifierForFunction.value }
        : { uploadedVideoPath: videoIdentifierForFunction.value };
      addLog(`'process-video' payload: ${JSON.stringify(functionPayload)}`);

      const { data: processResponse, error: processError } = await supabase.functions.invoke<{
        message: string;
        initialClips: InitialClipData[];
        processedVideoDetails: ProcessedVideoDetails;
      }>(
        'process-video', // Name of your Supabase Edge Function
        { body: functionPayload }
      );

      // Log raw response/error for easier debugging
      addLog(`'process-video' raw response: ${JSON.stringify(processResponse, null, 2)}`);
      addLog(`'process-video' raw error: ${JSON.stringify(processError, null, 2)}`);

      if (processError) {
        let detailedErrorMessage = processError.message || 'Unknown error from Edge Function';
        // @ts-ignore - Supabase error context can be complex
        if (processError.context?.body && typeof processError.context.body === 'string') {
            try { // @ts-ignore
                const errorBody = JSON.parse(processError.context.body);
                detailedErrorMessage += ` | Server Detail: ${errorBody.error_message || errorBody.error || JSON.stringify(errorBody)}`;
            } catch (e) { /* Ignore JSON parsing errors within the error context itself */ }
        // @ts-ignore
        } else if (processError.context?.status) { // @ts-ignore
             detailedErrorMessage += ` (Status: ${processError.context.status})`;
        }
        addLog(`Error invoking 'process-video': ${detailedErrorMessage}`);
        throw new Error(`'process-video' function call failed: ${detailedErrorMessage}`);
      }

      // Validate the structure of the successful response
      if (!processResponse?.initialClips || !processResponse?.processedVideoDetails) {
        console.error("Invalid response structure from 'process-video':", processResponse);
        addLog("Error: Received invalid data structure from 'process-video' function. Check Edge Function logs on Supabase dashboard.");
        throw new Error("Invalid response from 'process-video'. Expected 'initialClips' and 'processedVideoDetails'.");
      }

      // --- 3. Process Successful Analysis ---
      addLog("'process-video' function completed successfully. Received potential clips metadata.");
      const initialClipsData: InitialClipData[] = processResponse.initialClips;
      // Map Gemini's output to our Clip interface, setting initial status
      const clipsWithStatus: Clip[] = initialClipsData.map((clip, index) => ({
        ...clip, // startTime, endTime, description, transcription
        id: `clip-${Date.now()}-${index}`, // Generate a unique ID
        status: 'pending', // Clips are identified; 'trim-video' would change this
      }));

      setClips(clipsWithStatus);
      setProcessedVideoDetails(processResponse.processedVideoDetails);
      setAnalysisComplete(true); // Signal that analysis is done and download is possible

      addLog(`Analysis complete. Identified ${clipsWithStatus.length} potential clips. Original video is ready for download.`);
      addLog(`Video Source Type: ${processResponse.processedVideoDetails.sourceType}, Identifier: ${processResponse.processedVideoDetails.pathOrUrl}`);

      // --- SECTION FOR 'trim-video' CALLS (Currently Commented Out) ---
      // If you re-enable trimming, this is where the loop would go.
      /*
      addLog(`Starting to process ${clipsWithStatus.length} potential clips sequentially for trimming...`);
      const finalClips: Clip[] = []; // To store results of trimming
      for (const clipData of clipsWithStatus) {
        // Update UI for the current clip being processed
        setClips(prev => prev.map(c => c.id === clipData.id ? { ...c, status: 'processing' } : c));
        try {
          addLog(`Invoking 'trim-video' for clip: "${clipData.description}" (Start: ${clipData.startTime}s, End: ${clipData.endTime}s)`);

          const trimFunctionPayload = {
            videoIdentifier: processResponse.processedVideoDetails.pathOrUrl,
            sourceType: processResponse.processedVideoDetails.sourceType,
            highlight: { // Data specific to this clip
              start: clipData.startTime,
              end: clipData.endTime,
              transcription: clipData.transcription,
              description: clipData.description,
            },
          };
          addLog(`'trim-video' function payload: ${JSON.stringify(trimFunctionPayload)}`);

          const { data: trimResponse, error: trimError } = await supabase.functions.invoke<{ clipUrl: string }>(
            'trim-video', // Name of your trimming Edge Function
            { body: trimFunctionPayload }
          );
          
          addLog(`'trim-video' raw response for "${clipData.description}": ${JSON.stringify(trimResponse)}`);
          addLog(`'trim-video' raw error for "${clipData.description}": ${JSON.stringify(trimError)}`);

          if (trimError) {
            // ... (similar detailed error handling as for 'process-video') ...
            throw new Error(`'trim-video' for "${clipData.description}" failed: ${trimError.message}`);
          }

          if (!trimResponse || !trimResponse.clipUrl) {
            throw new Error(`'trim-video' for "${clipData.description}" did not return a clipUrl.`);
          }

          addLog(`Clip processed by 'trim-video': "${clipData.description}", URL: ${trimResponse.clipUrl}`);
          const completedClip = { ...clipData, clipUrl: trimResponse.clipUrl, status: 'completed' as const };
          finalClips.push(completedClip);
          setClips(prev => prev.map(c => c.id === clipData.id ? completedClip : c));

        } catch (trimClipError: any) {
          addLog(`Error processing clip "${clipData.description}" with 'trim-video': ${trimClipError.message}`);
          const failedClip = { ...clipData, status: 'failed' as const, error: trimClipError.message };
          finalClips.push(failedClip);
          setClips(prev => prev.map(c => c.id === clipData.id ? failedClip : c));
        }
      }
      addLog("All clips processing (trimming) attempted.");
      */
      // --- End of 'trim-video' section ---

    } catch (error: any) {
      // Catch errors from any part of the try block (upload, function invocation, response validation)
      addLog(`Error in main analysis flow: ${error.message}`);
      console.error("Full error object in handleSubmit:", error);
      setAnalysisComplete(false); // Ensure download isn't possible if analysis failed
      // Mark any clips that might have been listed (e.g., if error happened during trim loop) as failed
      setClips(prev => prev.map(c =>
        (c.status === 'pending' || c.status === 'processing')
          ? { ...c, status: 'failed', error: "Main analysis process failed or was interrupted. Check logs." }
          : c
      ));
    } finally {
      // This block runs whether the try block succeeded or failed
      setProcessing(false); // Stop loading/processing indicator
      
      // Optionally clear inputs after processing.
      // For file uploads, it's good to clear the file input ref.
      if (fileInputRef.current) {
          fileInputRef.current.value = ""; // Resets the file input visually
      }
      // Clearing selectedFile might be good too, or keep it if user might re-submit same file.
      // setSelectedFile(null); 
      // Clearing videoUrlInput is optional, user might want to retry.
      // setVideoUrlInput(''); 
    }
  };

  // --- JSX Rendering ---
  return (
    <div className="App">
      <header className="App-header">
        <h1>Minimal Video Clipping Tool</h1>
        <p>Powered by Supabase & Gemini</p>
      </header>
      <main>
        {/* Input Section: Video URL or File Upload */}
        <div className="input-section card">
          <h2>1. Provide Video</h2>
           <div className="input-type-selector">
             <label>
               <input
                 type="radio"
                 name="inputType"
                 value="url"
                 checked={inputType === 'url'}
                 // When switching, reset states associated with the other input type
                 onChange={() => {
                   setInputType('url');
                   setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]);
                   setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = "";
                 }}
                 disabled={processing}
               />
               Video URL (e.g., YouTube, direct MP4 link)
             </label>
             <label>
               <input
                 type="radio"
                 name="inputType"
                 value="upload"
                 checked={inputType === 'upload'}
                 // When switching, reset states associated with the other input type
                 onChange={() => {
                   setInputType('upload');
                   setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]);
                   setVideoUrlInput('');
                 }}
                 disabled={processing}
               />
               Upload File (Max 900MB recommended)
             </label>
           </div>

           {/* Conditional input fields based on selected inputType */}
           {inputType === 'url' && (
             <input
               type="text"
               placeholder="Enter YouTube or direct video URL"
               value={videoUrlInput}
               // Reset analysis state if URL changes
               onChange={(e) => { setVideoUrlInput(e.target.value); setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]); }}
               disabled={processing}
               style={{width: '90%', padding: '10px', margin: '10px 0'}}
             />
           )}
           {inputType === 'upload' && (
             <input
               type="file"
               accept="video/*" // Accept any video MIME type
               onChange={handleFileChange} // handleFileChange also resets analysis states
               ref={fileInputRef}
               disabled={processing}
               style={{margin: '10px 0'}}
             />
           )}
          <button
             onClick={handleSubmit}
             // Disable button if processing or if required input is missing
             disabled={processing || (inputType === 'url' && !videoUrlInput.trim()) || (inputType === 'upload' && !selectedFile)}
          >
            {processing ? 'Analyzing Video...' : 'Analyze Video'}
          </button>
        </div>

        {/* Download Section: Shown only after successful analysis */}
        {analysisComplete && processedVideoDetails && !processing && (
            <div className="download-section card">
                <h2>2. Download Original Video</h2>
                <p>Analysis complete. You can now download the original video that was analyzed.</p>
                <button onClick={handleDownloadOriginal}>
                    Download Original Video
                </button>
                <p style={{fontSize: '0.8em', marginTop: '10px', wordBreak: 'break-all'}}>
                   Source Type: {processedVideoDetails.sourceType} <br/>
                   Identifier: {processedVideoDetails.pathOrUrl}
                </p>
            </div>
        )}

        {/* Processing Logs Section */}
        <div className="results-section card">
          {/* Adjust heading number based on whether download section is visible */}
          <h2>{analysisComplete && processedVideoDetails && !processing ? '3.' : '2.'} Processing Logs</h2>
          <div className="logs">
            {logs.length === 0 && !processing && <p>Submit a video to start analysis. Logs will appear here.</p>}
            {logs.map((log, index) => (
              // Simple conditional styling for error/success logs
              <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : (log.toLowerCase().includes('success') ? 'log-success' : '')}>{log}</p>
            ))}
          </div>
        </div>

        {/* Potential Clips Section: Shows clips identified by Gemini */}
        <div className="results-section card">
          <h2>{analysisComplete && processedVideoDetails && !processing ? '4.' : '3.'} Potential Clips Identified</h2>
          {clips.length > 0 && (
            <ul className="clips-list">
              {clips.map((clip) => (
                <li key={clip.id} className={`clip-item status-${clip.status}`}>
                  <strong>Description:</strong> {clip.description} <br />
                  <strong>Timestamps:</strong> {clip.startTime}s - {clip.endTime}s <br />
                  <strong>Transcription:</strong> {clip.transcription || "N/A"} <br />
                  <strong>Status:</strong> <span className={`status-badge status-${clip.status}`}>{clip.status}</span>
                  {/* No clip download link shown since trimming is currently disabled */}
                  {clip.error && <p className="error-message">Error: {clip.error}</p>}
                </li>
              ))}
            </ul>
          )}
          {/* Informational messages based on state */}
          {processing && logs.length > 0 && <p>Analyzing video and identifying potential clips... This may take a few minutes for longer videos.</p>}
          {!processing && analysisComplete && clips.length === 0 && logs.length > 0 && <p>Analysis finished, but no specific clips were identified by the AI from this video.</p>}
          {!processing && !analysisComplete && logs.length > 0 && logs.some(log => log.toLowerCase().includes('error')) && <p>Analysis failed. Please review the logs above for details.</p>}
          {!processing && !analysisComplete && clips.length === 0 && logs.length === 0 && <p>No clips identified yet. Ready to analyze.</p>}
        </div>
      </main>
    </div>
  );
}
// --- End App Component ---

export default App;