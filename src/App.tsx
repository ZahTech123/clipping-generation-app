import React, { useState, useEffect, useRef } from 'react'; // Ensure useEffect is imported
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import './App.css'; // Make sure you have some basic styling

// --- START: Correct Supabase Initialization ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("CRITICAL ERROR: Supabase URL and Anon Key are required. Check your .env file (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) and ensure the dev server was restarted after changes.");
  alert("Application cannot start: Supabase configuration is missing. Check console and .env settings.");
  // In a real app, render a full-page error component here instead of alert.
}
const supabase: SupabaseClient = createClient(supabaseUrl!, supabaseAnonKey!);
// --- END: Correct Supabase Initialization ---


// --- Interfaces ---
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

interface ProcessedVideoDetails {
    pathOrUrl: string;
    sourceType: 'supabase' | 'external_url';
}
// --- End Interfaces ---


// --- App Component ---
function App() {
  // --- State Variables ---
  const [videoUrlInput, setVideoUrlInput] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputType, setInputType] = useState<'url' | 'upload'>('url');
  const [processedVideoDetails, setProcessedVideoDetails] = useState<ProcessedVideoDetails | null>(null);
  const [analysisComplete, setAnalysisComplete] = useState<boolean>(false);

  // NEW STATE for API health check
  const [apiStatus, setApiStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const [apiError, setApiError] = useState<string | null>(null);
  // --- End State Variables ---

  // Helper to add messages to the log UI (defined early for useEffect)
  const addLog = (message: string) => {
    console.log(message);
    setLogs(prevLogs => [new Date().toLocaleTimeString() + ': ' + message, ...prevLogs].slice(0, 100));
  };

  // --- useEffect for API Health Check on Mount ---
  useEffect(() => {
    const checkApiHealth = async () => {
      addLog('Performing Vercel API health check for /api/hello...');
      setApiStatus('pending'); // Explicitly set to pending at start of check
      try {
        const response = await fetch('/api/hello'); // Request to your Vercel function

        if (response.ok) {
          const data = await response.json();
          // Verify the expected message from your api/hello.js
          if (data.message && data.message.includes("Hello from the Vercel API!")) {
            addLog('Vercel API health check successful. Backend functions seem reachable.');
            setApiStatus('ok');
            setApiError(null);
          } else {
            addLog(`Vercel API health check warning: /api/hello responded OK but with unexpected data: ${JSON.stringify(data)}`);
            setApiStatus('error'); // Treat unexpected success as an error for robustness
            setApiError('API responded with unexpected data.');
          }
        } else {
          // This block handles HTTP errors like 404 (Not Found), 500 (Server Error),
          // or if Vercel serves the SPA fallback (which would likely be text/html and not response.ok for a JSON API).
          addLog(`Vercel API health check failed: /api/hello responded with status ${response.status}.`);
          if (response.status === 404) {
            setApiError(`Vercel API endpoint /api/hello not found (404). Ensure it's deployed correctly.`);
          } else {
            setApiError(`Vercel API /api/hello responded with HTTP error ${response.status}. Check Vercel function logs.`);
          }
          setApiStatus('error');
        }
      } catch (error: any) {
        // This block catches network errors (e.g., function totally unreachable) or if fetch itself throws
        console.error("Vercel API health check fetch error:", error);
        addLog(`Vercel API health check critical error: ${error.message}. Could not connect to /api/hello.`);
        setApiStatus('error');
        setApiError(error.message || 'Failed to connect to Vercel API. Functions may be unavailable or misconfigured.');
      }
    };

    // Only run if Supabase config is present, as that's a prerequisite
    if (supabaseUrl && supabaseAnonKey) {
        checkApiHealth();
    } else {
        setApiStatus('error');
        const configErrorMsg = 'Supabase configuration missing, cannot perform API health check.';
        setApiError(configErrorMsg);
        addLog(configErrorMsg); // Log this specific error
    }
  }, []); // Empty dependency array: runs once on component mount
  // --- End useEffect for API Health Check ---

  // Handles file selection from the input
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // ... (Identical to your previous version)
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      if (file.size > 900 * 1024 * 1024) {
        addLog(`Error: File size exceeds 900MB limit. Selected file is ${(file.size / (1024 * 1024)).toFixed(2)} MB`);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setSelectedFile(file);
      setProcessedVideoDetails(null);
      setAnalysisComplete(false);
      setClips([]);
      addLog(`File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    } else {
      setSelectedFile(null);
    }
  };

  // Handles the "Download Original Video" button click
  const handleDownloadOriginal = () => {
    // ... (Identical to your previous version)
    if (apiStatus !== 'ok') {
        addLog('Cannot download: Vercel API functions are not available. Please check connection status.');
        alert('Backend services are currently unavailable. Please try again later.');
        return;
    }
    if (!processedVideoDetails) {
        addLog('Error: No processed video details available for download. Please analyze a video first.');
        return;
    }
    addLog('Initiating download of the original analyzed video...');
    const { pathOrUrl, sourceType } = processedVideoDetails;
    const downloadApiUrl = `/api/download-video`;
    const params = new URLSearchParams({ sourceType: sourceType, identifier: pathOrUrl });
    const fullDownloadUrl = `${downloadApiUrl}?${params.toString()}`;
    addLog(`Requesting download from Vercel function: ${fullDownloadUrl}`);
    window.open(fullDownloadUrl, '_blank');
  };

  // Main handler for submitting the video for analysis
  const handleSubmit = async () => {
    // Check API status before proceeding with Supabase calls
    if (apiStatus === 'error') {
        addLog('Cannot process video: Vercel API functions are not available. Please check the initial API health check logs.');
        alert('The application cannot connect to its backend Vercel services. Please try again later or contact support if the issue persists.');
        return;
    }
    if (apiStatus === 'pending') {
        addLog('Vercel API health check still in progress. Please wait a moment before submitting.');
        // Optionally, disable submit button while API status is 'pending' (already handled by JSX)
        return;
    }

    setProcessing(true);
    setLogs([]);
    setClips([]);
    setProcessedVideoDetails(null);
    setAnalysisComplete(false);
    addLog('Starting video analysis flow...');

    let videoIdentifierForFunction: { type: 'url', value: string } | { type: 'storagePath', value: string };

    try {
      // --- 1. Determine Video Source ---
      // ... (Identical to your previous handleSubmit video source determination logic)
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
        const sanitizedFileName = baseFileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const timestamp = Date.now();
        const supabasePath = `uploads/${timestamp}_${sanitizedFileName}${fileExt ? '.' + fileExt : ''}`;

        addLog(`Attempting to upload to Supabase bucket 'raw-videos' at path: ${supabasePath}`);
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('raw-videos')
          .upload(supabasePath, selectedFile, {
            cacheControl: '3600',
            upsert: false,
            contentType: selectedFile.type || 'application/octet-stream',
          });

        if (uploadError) {
          addLog(`Supabase upload error: ${uploadError.message}`);
          throw new Error(`Supabase upload failed: ${uploadError.message}`);
        }
        if (!uploadData || !uploadData.path) {
           addLog(`Supabase upload error: No path returned after upload.`);
           throw new Error(`Supabase upload failed: No path returned from storage.`);
        }
        addLog(`File uploaded successfully to Supabase Storage: ${uploadData.path}`);
        videoIdentifierForFunction = { type: 'storagePath', value: uploadData.path };
      } else {
        addLog('Error: No Video URL provided or no file selected for analysis.');
        setProcessing(false);
        return;
      }

      // --- 2. Invoke 'process-video' Supabase Edge Function ---
      // ... (Identical to your previous 'process-video' invocation and error handling logic)
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
        'process-video',
        { body: functionPayload }
      );

      addLog(`'process-video' raw response: ${JSON.stringify(processResponse, null, 2)}`);
      addLog(`'process-video' raw error: ${JSON.stringify(processError, null, 2)}`);

      if (processError) {
        let detailedErrorMessage = processError.message || 'Unknown error from Edge Function';
        // @ts-ignore
        if (processError.context?.body && typeof processError.context.body === 'string') {
            try { // @ts-ignore
                const errorBody = JSON.parse(processError.context.body);
                detailedErrorMessage += ` | Server Detail: ${errorBody.error_message || errorBody.error || JSON.stringify(errorBody)}`;
            } catch (e) { /* Ignore */ }
        // @ts-ignore
        } else if (processError.context?.status) { // @ts-ignore
             detailedErrorMessage += ` (Status: ${processError.context.status})`;
        }
        addLog(`Error invoking 'process-video': ${detailedErrorMessage}`);
        throw new Error(`'process-video' function call failed: ${detailedErrorMessage}`);
      }

      if (!processResponse?.initialClips || !processResponse?.processedVideoDetails) {
        console.error("Invalid response structure from 'process-video':", processResponse);
        addLog("Error: Received invalid data structure from 'process-video' function. Check Edge Function logs.");
        throw new Error("Invalid response from 'process-video'. Expected 'initialClips' and 'processedVideoDetails'.");
      }

      // --- 3. Process Successful Analysis ---
      // ... (Identical to your previous successful analysis processing logic)
      addLog("'process-video' function completed successfully. Received potential clips metadata.");
      const initialClipsData: InitialClipData[] = processResponse.initialClips;
      const clipsWithStatus: Clip[] = initialClipsData.map((clip, index) => ({
        ...clip,
        id: `clip-${Date.now()}-${index}`,
        status: 'pending',
      }));

      setClips(clipsWithStatus);
      setProcessedVideoDetails(processResponse.processedVideoDetails);
      setAnalysisComplete(true);

      addLog(`Analysis complete. Identified ${clipsWithStatus.length} potential clips. Original video is ready for download.`);
      addLog(`Video Source Type: ${processResponse.processedVideoDetails.sourceType}, Identifier: ${processResponse.processedVideoDetails.pathOrUrl}`);

      // --- 'trim-video' section remains commented out ---
      /* ... */

    } catch (error: any) {
      addLog(`Error in main analysis flow: ${error.message}`);
      console.error("Full error object in handleSubmit:", error);
      setAnalysisComplete(false);
      setClips(prev => prev.map(c =>
        (c.status === 'pending' || c.status === 'processing')
          ? { ...c, status: 'failed', error: "Main analysis process failed or was interrupted. Check logs." }
          : c
      ));
    } finally {
      setProcessing(false);
      if (fileInputRef.current) {
          fileInputRef.current.value = "";
      }
    }
  };
  // --- End handleSubmit ---


  // --- JSX Rendering with Conditional UI based on API Status ---
  if (!supabaseUrl || !supabaseAnonKey) {
    // This should ideally be a full-page error component for better UX
    return (
        <div className="App">
            <header className="App-header"><h1>Configuration Error</h1></header>
            <main><p className="log-error">CRITICAL: Application cannot start due to missing Supabase configuration. Please contact support or check .env settings.</p></main>
        </div>
    );
  }

  if (apiStatus === 'pending') {
    return (
      <div className="App">
        <header className="App-header"><h1>Minimal Video Clipping Tool</h1><p>Powered by Supabase & Gemini</p></header>
        <main>
          <div className="card">
            <h2>Connecting to Backend Services...</h2>
            <p>Please wait while we verify the connection to our Vercel API functions.</p>
            <p>This usually takes a few seconds.</p>
          </div>
          <div className="results-section card">
            <h2>Initial Connection Logs</h2>
            <div className="logs">
                {logs.slice(-5).map((log, index) => ( <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : ''}>{log}</p> ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (apiStatus === 'error') {
    return (
      <div className="App">
        <header className="App-header"><h1>Application Error</h1> <p>Backend Connection Failed</p></header>
        <main>
          <div className="card">
            <h2 className="log-error">Could Not Connect to Vercel API Functions</h2>
            <p>The application's backend services (Vercel functions like /api/hello and /api/download-video) are currently unavailable or not responding correctly.</p>
            <p><strong>Error Details:</strong> {apiError || "An unknown error occurred during API health check."}</p>
            <p>Please try refreshing the page in a few moments. If the problem persists, it might indicate an issue with the Vercel deployment or routing.</p>
            <p>You can check the browser console (F12) for more technical details.</p>
          </div>
          <div className="results-section card">
            <h2>Detailed Error Logs</h2>
            <div className="logs">
                {logs.map((log, index) => ( <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : ''}>{log}</p> ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --- If apiStatus is 'ok', render the main application UI ---
  return (
    <div className="App">
      <header className="App-header">
        <h1>Minimal Video Clipping Tool</h1>
        <p>Powered by Supabase & Gemini (Vercel API: OK)</p>
      </header>
      <main>
        {/* Input Section */}
        <div className="input-section card">
          <h2>1. Provide Video</h2>
           <div className="input-type-selector">
             <label>
               <input type="radio" name="inputType" value="url" checked={inputType === 'url'}
                 onChange={() => { setInputType('url'); setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                 disabled={processing}/>
               Video URL (e.g., YouTube, direct MP4 link)
             </label>
             <label>
               <input type="radio" name="inputType" value="upload" checked={inputType === 'upload'}
                 onChange={() => { setInputType('upload'); setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]); setVideoUrlInput(''); }}
                 disabled={processing}/>
               Upload File (Max 900MB recommended)
             </label>
           </div>
           {inputType === 'url' && (
             <input type="text" placeholder="Enter YouTube or direct video URL" value={videoUrlInput}
               onChange={(e) => { setVideoUrlInput(e.target.value); setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]); }}
               disabled={processing} style={{width: '90%', padding: '10px', margin: '10px 0'}}/>
           )}
           {inputType === 'upload' && (
             <input type="file" accept="video/*" onChange={handleFileChange} ref={fileInputRef}
               disabled={processing} style={{margin: '10px 0'}} />
           )}
          <button onClick={handleSubmit}
             disabled={processing || (inputType === 'url' && !videoUrlInput.trim()) || (inputType === 'upload' && !selectedFile) || apiStatus !== 'ok'}>
            {processing ? 'Analyzing Video...' : (apiStatus !== 'ok' ? 'API Offline' : 'Analyze Video')}
          </button>
        </div>

        {/* Download Section */}
        {analysisComplete && processedVideoDetails && !processing && apiStatus === 'ok' && (
            <div className="download-section card">
                <h2>2. Download Original Video</h2>
                <p>Analysis complete. You can now download the original video that was analyzed.</p>
                <button onClick={handleDownloadOriginal} disabled={apiStatus !== 'ok'}>
                    {apiStatus !== 'ok' ? 'API Offline' : 'Download Original Video'}
                </button>
                <p style={{fontSize: '0.8em', marginTop: '10px', wordBreak: 'break-all'}}>
                   Source Type: {processedVideoDetails.sourceType} <br/> Identifier: {processedVideoDetails.pathOrUrl}
                </p>
            </div>
        )}

        {/* Processing Logs Section */}
        <div className="results-section card">
          <h2>{analysisComplete && processedVideoDetails && !processing ? '3.' : '2.'} Processing Logs</h2>
          <div className="logs">
            {logs.length === 0 && !processing && <p>Submit a video to start analysis. Logs will appear here.</p>}
            {logs.map((log, index) => (
              <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : (log.toLowerCase().includes('success') ? 'log-success' : '')}>{log}</p>
            ))}
          </div>
        </div>

        {/* Potential Clips Section */}
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
                  {clip.error && <p className="error-message">Error: {clip.error}</p>}
                </li>
              ))}
            </ul>
          )}
          {processing && logs.length > 0 && <p>Analyzing video and identifying potential clips...</p>}
          {!processing && analysisComplete && clips.length === 0 && logs.length > 0 && <p>Analysis finished, but no specific clips were identified.</p>}
          {!processing && !analysisComplete && logs.length > 0 && logs.some(log => log.toLowerCase().includes('error')) && <p>Analysis failed. Please review the logs.</p>}
          {!processing && !analysisComplete && clips.length === 0 && logs.length === 0 && apiStatus === 'ok' && <p>Ready to analyze a video.</p>}
        </div>
      </main>
    </div>
  );
}
// --- End App Component ---

export default App;