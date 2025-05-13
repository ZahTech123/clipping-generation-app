import React, { useState, useEffect, useRef } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import './App.css'; // Make sure you have some basic styling

// --- START: Correct Supabase Initialization ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("CRITICAL ERROR: Supabase URL and Anon Key are required. Check your .env file (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) and ensure the dev server was restarted after changes.");
  alert("Application cannot start: Supabase configuration is missing. Check console and .env settings.");
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
interface InitialClipData { startTime: number; endTime: number; description: string; transcription: string; }
interface ProcessedVideoDetails { pathOrUrl: string; sourceType: 'supabase' | 'external_url'; }
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

  const [apiStatus, setApiStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const [apiError, setApiError] = useState<string | null>(null);
  // --- End State Variables ---

  // Helper to add messages to the log UI
  const addLog = (message: string) => {
    console.log(message);
    setLogs(prevLogs => [new Date().toLocaleTimeString() + ': ' + message, ...prevLogs].slice(0, 100));
  };

  // --- useEffect for API Health Check on Mount ---
  useEffect(() => {
    const checkApiHealth = async () => {
      addLog('Performing Vercel API health check for /api/hello...');
      setApiStatus('pending');
      try {
        const response = await fetch('/api/hello'); // Request to your Vercel function

        if (response.ok) {
          const data = await response.json();
          // CORRECTED CHECK: Verify the exact expected message from your api/hello.js
          if (data.message && data.message === "Hello from minimal API!") { // <<<<< ***** THIS IS THE KEY CORRECTION *****
            addLog('Vercel API health check successful. Backend functions seem reachable.');
            setApiStatus('ok');
            setApiError(null);
          } else {
            addLog(`Vercel API health check warning: /api/hello responded OK but with unexpected data. Expected { message: "Hello from minimal API!" }, got: ${JSON.stringify(data)}`);
            setApiStatus('error');
            setApiError('API /api/hello responded with unexpected data structure or message content.');
          }
        } else {
          addLog(`Vercel API health check failed: /api/hello responded with status ${response.status}.`);
          let errorText = `Vercel API /api/hello responded with HTTP error ${response.status}.`;
          if (response.status === 404) {
            errorText = `Vercel API endpoint /api/hello not found (404). Ensure it's deployed correctly and Vercel routing is working.`;
          } else {
            try { // Attempt to get more info from the response body
                const text = await response.text();
                if (text.toLowerCase().includes("<!doctype html>")) {
                    errorText += " It appears the SPA fallback page was served instead of the API function.";
                } else if (text.length < 250) { // Show short error messages from server
                    errorText += ` Server message: ${text}`;
                }
            } catch (_) { /* Ignore if reading text fails */ }
          }
          setApiError(errorText);
          setApiStatus('error');
        }
      } catch (error: any) {
        console.error("Vercel API health check fetch error (means /api/hello is not reachable or returned non-JSON/HTML):", error);
        let errorMsg = error.message || 'Failed to connect to Vercel API /api/hello.';
        if (error instanceof SyntaxError && error.message.toLowerCase().includes("unexpected token '<'")) {
            errorMsg = "Received HTML instead of JSON from /api/hello. Vercel function might not be running or routing is incorrect.";
        } else if (error instanceof SyntaxError) { // Other JSON parsing errors
            errorMsg = `Error parsing response from /api/hello as JSON: ${error.message}. Response might not be valid JSON.`;
        }
        addLog(`Vercel API health check critical error: ${errorMsg}`);
        setApiStatus('error');
        setApiError(errorMsg);
      }
    };

    if (supabaseUrl && supabaseAnonKey) {
        checkApiHealth();
    } else {
        setApiStatus('error');
        const configErrorMsg = 'Supabase configuration missing; API health check skipped.';
        setApiError(configErrorMsg);
        addLog(configErrorMsg);
    }
  }, []); // Empty dependency array: runs once on component mount
  // --- End useEffect for API Health Check ---

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      if (file.size > 900 * 1024 * 1024) {
        addLog(`Error: File size exceeds 900MB limit. Selected file is ${(file.size / (1024 * 1024)).toFixed(2)} MB`);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setSelectedFile(file);
      setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]);
      addLog(`File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    } else {
      setSelectedFile(null);
    }
  };

  const handleDownloadOriginal = () => {
    if (apiStatus !== 'ok') {
        addLog('Cannot download: Vercel API functions are not available. Please check connection status.');
        alert('Backend services (Vercel Functions) are currently unavailable. Please try again later.');
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

  const handleSubmit = async () => {
    if (apiStatus === 'error') {
        addLog('Cannot process video: Vercel API functions are not available. Please check the initial API health check logs.');
        alert('The application cannot connect to its backend Vercel services. Please try again later or contact support if the issue persists.');
        return;
    }
    if (apiStatus === 'pending') {
        addLog('Vercel API health check still in progress. Please wait a moment before submitting.');
        return;
    }

    setProcessing(true);
    setLogs([]); setClips([]); setProcessedVideoDetails(null); setAnalysisComplete(false);
    addLog('Starting video analysis flow...');
    let videoIdentifierForFunction: { type: 'url', value: string } | { type: 'storagePath', value: string };

    try {
      if (inputType === 'url' && videoUrlInput) {
        if (!videoUrlInput.trim()) { addLog('Error: Video URL cannot be empty.'); setProcessing(false); return; }
        addLog(`Analyzing Video URL: ${videoUrlInput}`);
        videoIdentifierForFunction = { type: 'url', value: videoUrlInput };
      } else if (inputType === 'upload' && selectedFile) {
        addLog(`Uploading file for analysis: ${selectedFile.name}`);
        const fileExt = selectedFile.name.split('.').pop()?.toLowerCase() || '';
        const baseFileName = selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.') > -1 ? selectedFile.name.lastIndexOf('.') : selectedFile.name.length);
        const sanitizedFileName = baseFileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const supabasePath = `uploads/${Date.now()}_${sanitizedFileName}${fileExt ? '.' + fileExt : ''}`;
        addLog(`Attempting Supabase upload to: ${supabasePath}`);
        const { data: uploadData, error: uploadError } = await supabase.storage.from('raw-videos').upload(supabasePath, selectedFile, { cacheControl: '3600', upsert: false, contentType: selectedFile.type || 'application/octet-stream' });
        if (uploadError) throw new Error(`Supabase upload failed: ${uploadError.message}`);
        if (!uploadData?.path) throw new Error(`Supabase upload failed: No path returned.`);
        addLog(`Supabase upload successful: ${uploadData.path}`);
        videoIdentifierForFunction = { type: 'storagePath', value: uploadData.path };
      } else {
        addLog('Error: No Video URL provided or no file selected for analysis.'); setProcessing(false); return;
      }

      addLog(`Invoking 'process-video' Supabase Edge Function...`);
      const functionPayload = videoIdentifierForFunction.type === 'url' ? { videoUrl: videoIdentifierForFunction.value } : { uploadedVideoPath: videoIdentifierForFunction.value };
      addLog(`'process-video' payload: ${JSON.stringify(functionPayload)}`);
      const { data: processResponse, error: processError } = await supabase.functions.invoke<{ message: string; initialClips: InitialClipData[]; processedVideoDetails: ProcessedVideoDetails; }>('process-video', { body: functionPayload });
      addLog(`'process-video' raw response: ${JSON.stringify(processResponse, null, 2)}`);
      addLog(`'process-video' raw error: ${JSON.stringify(processError, null, 2)}`);
      if (processError) {
        let detailedErrorMessage = processError.message || 'Unknown error from Supabase Edge Function';
        // @ts-ignore
        if (processError.context?.body && typeof processError.context.body === 'string') { try { const errorBody = JSON.parse(processError.context.body); detailedErrorMessage += ` | Server Detail: ${errorBody.error_message || errorBody.error || JSON.stringify(errorBody)}`; } catch (e) { /* Ignore */ } }
        // @ts-ignore
        else if (processError.context?.status) { detailedErrorMessage += ` (Status: ${processError.context.status})`; }
        throw new Error(`'process-video' function call failed: ${detailedErrorMessage}`);
      }
      if (!processResponse?.initialClips || !processResponse?.processedVideoDetails) {
        throw new Error("Invalid response from 'process-video'. Expected 'initialClips' and 'processedVideoDetails'.");
      }

      addLog("'process-video' function completed successfully. Received potential clips metadata.");
      const initialClipsData: InitialClipData[] = processResponse.initialClips;
      const clipsWithStatus: Clip[] = initialClipsData.map((clip, index) => ({ ...clip, id: `clip-${Date.now()}-${index}`, status: 'pending' }));
      setClips(clipsWithStatus);
      setProcessedVideoDetails(processResponse.processedVideoDetails);
      setAnalysisComplete(true);
      addLog(`Analysis complete. Identified ${clipsWithStatus.length} clips. Original video is ready for download.`);
      addLog(`Video Source: ${processResponse.processedVideoDetails.sourceType}, Identifier: ${processResponse.processedVideoDetails.pathOrUrl}`);
    } catch (error: any) {
      addLog(`Error in main analysis flow: ${error.message}`);
      console.error("Full error object in handleSubmit:", error);
      setAnalysisComplete(false);
      setClips(prev => prev.map(c => (c.status === 'pending' || c.status === 'processing') ? { ...c, status: 'failed', error: "Main analysis process failed or was interrupted. Check logs." } : c ));
    } finally {
      setProcessing(false);
      if (fileInputRef.current) { fileInputRef.current.value = ""; }
    }
  };

  if (!supabaseUrl || !supabaseAnonKey) {
    return (<div className="App"><header className="App-header"><h1>Configuration Error</h1></header><main><p className="log-error">CRITICAL: Application cannot start due to missing Supabase configuration.</p></main></div>);
  }
  if (apiStatus === 'pending') {
    return (
      <div className="App">
        <header className="App-header"><h1>Minimal Video Clipping Tool</h1><p>Powered by Supabase & Gemini</p></header>
        <main>
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <h2>Connecting to Backend Services...</h2>
            <p>Please wait while we verify the connection to our Vercel API functions.</p>
            <div className="loader" style={{ /* Basic CSS Loader */ width: '50px', height: '50px', border: '5px solid #f3f3f3', borderTop: '5px solid #3498db', borderRadius: '50%', margin: '20px auto', animation: 'spin 1s linear infinite' }}></div>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
          <div className="results-section card" style={{maxHeight: '150px', overflowY: 'auto'}}>
            <h2>Initial Connection Logs</h2>
            <div className="logs"> {logs.slice(-3).map((log, index) => ( <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : ''}>{log}</p> ))} </div>
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
          <div className="card" style={{borderLeft: '5px solid red'}}>
            <h2 className="log-error" style={{color: 'red'}}>Could Not Connect to Vercel API Functions</h2>
            <p>The application's backend services (Vercel functions, e.g., /api/hello, /api/download-video) are currently unavailable or not responding as expected.</p>
            <p><strong>Error Details:</strong> {apiError || "An unknown error occurred during the API health check."}</p>
            <p>This might be a temporary issue, or it could indicate a problem with the Vercel deployment or routing for API functions.</p>
            <p><strong>What to do:</strong></p>
            <ul style={{textAlign: 'left', paddingLeft: '20px'}}>
                <li>Try refreshing the page in a few moments.</li>
                <li>Check your internet connection.</li>
                <li>If the problem persists, the Vercel functions might need attention (check Vercel dashboard for function logs and deployment status).</li>
            </ul>
            <p>You can also check the browser console (F12) for more technical details.</p>
          </div>
          <div className="results-section card" style={{maxHeight: '200px', overflowY: 'auto'}}>
            <h2>Detailed Error Logs</h2>
            <div className="logs"> {logs.map((log, index) => ( <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : ''}>{log}</p> ))} </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>Minimal Video Clipping Tool</h1>
        <p>Powered by Supabase & Gemini (Vercel API: <span style={{color: 'lightgreen', fontWeight: 'bold'}}>OK</span>)</p>
      </header>
      <main>
        <div className="input-section card">
          <h2>1. Provide Video</h2>
           <div className="input-type-selector">
             <label><input type="radio" name="inputType" value="url" checked={inputType === 'url'} onChange={() => { setInputType('url'); setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} disabled={processing}/> Video URL</label>
             <label><input type="radio" name="inputType" value="upload" checked={inputType === 'upload'} onChange={() => { setInputType('upload'); setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]); setVideoUrlInput(''); }} disabled={processing}/> Upload File</label>
           </div>
           {inputType === 'url' && (<input type="text" placeholder="Enter YouTube or direct video URL" value={videoUrlInput} onChange={(e) => { setVideoUrlInput(e.target.value); setProcessedVideoDetails(null); setAnalysisComplete(false); setClips([]); }} disabled={processing} style={{width: '90%', padding: '10px', margin: '10px 0'}}/>)}
           {inputType === 'upload' && (<input type="file" accept="video/*" onChange={handleFileChange} ref={fileInputRef} disabled={processing} style={{margin: '10px 0'}} />)}
          <button onClick={handleSubmit} disabled={processing || (inputType === 'url' && !videoUrlInput.trim()) || (inputType === 'upload' && !selectedFile) || apiStatus !== 'ok'}>
            {processing ? 'Analyzing Video...' : (apiStatus !== 'ok' ? 'API OFFLINE' : 'Analyze Video')}
          </button>
        </div>
        {analysisComplete && processedVideoDetails && !processing && apiStatus === 'ok' && (
            <div className="download-section card">
                <h2>2. Download Original Video</h2>
                <p>Analysis complete. You can now download the original video that was analyzed.</p>
                <button onClick={handleDownloadOriginal} disabled={apiStatus !== 'ok'}>
                    {apiStatus !== 'ok' ? 'API OFFLINE' : 'Download Original Video'}
                </button>
                <p style={{fontSize: '0.8em', marginTop: '10px', wordBreak: 'break-all'}}>Source Type: {processedVideoDetails.sourceType} <br/> Identifier: {processedVideoDetails.pathOrUrl}</p>
            </div>
        )}
        <div className="results-section card">
          <h2>{analysisComplete && processedVideoDetails && !processing && apiStatus === 'ok' ? '3.' : '2.'} Processing Logs</h2>
          <div className="logs">{logs.length === 0 && !processing && <p>Submit a video to start analysis. Logs will appear here.</p>}{logs.map((log, index) => ( <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : (log.toLowerCase().includes('success') ? 'log-success' : '')}>{log}</p> ))}</div>
        </div>
        <div className="results-section card">
          <h2>{analysisComplete && processedVideoDetails && !processing && apiStatus === 'ok' ? '4.' : '3.'} Potential Clips Identified</h2>
          {clips.length > 0 && (<ul className="clips-list">{clips.map((clip) => (<li key={clip.id} className={`clip-item status-${clip.status}`}><strong>Description:</strong> {clip.description} <br /><strong>Timestamps:</strong> {clip.startTime}s - {clip.endTime}s <br /><strong>Transcription:</strong> {clip.transcription || "N/A"} <br /><strong>Status:</strong> <span className={`status-badge status-${clip.status}`}>{clip.status}</span>{clip.error && <p className="error-message">Error: {clip.error}</p>}</li>))}</ul>)}
          {processing && logs.length > 0 && <p>Analyzing video and identifying potential clips...</p>}
          {!processing && analysisComplete && clips.length === 0 && logs.length > 0 && <p>Analysis finished, but no specific clips were identified by the AI.</p>}
          {!processing && !analysisComplete && logs.length > 0 && logs.some(log => log.toLowerCase().includes('error')) && <p>Analysis failed. Please review the logs for details.</p>}
          {!processing && !analysisComplete && clips.length === 0 && logs.length === 0 && apiStatus === 'ok' && <p>Ready to analyze a video.</p>}
        </div>
      </main>
    </div>
  );
}
export default App;