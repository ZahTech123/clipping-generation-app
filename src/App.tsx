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

// --- Define Local API Base URL ---
const LOCAL_API_BASE_URL = 'http://localhost:3000';
// --- END: Local API Base URL ---


// --- Interfaces ---
interface InitialClipData {
  startTime: number;
  endTime: number;
  description: string;
  hookPhraseTitle: string;
  clipTranscription: string;
  primaryViralCharacteristic: string;
  viralPotentialScore: number;
  reasoningForScore: string;
}

interface Clip extends InitialClipData {
  id: string;
  status: 'pending' | 'clipping' | 'downloading' | 'completed' | 'failed' | 'failed_clip';
  error?: string;
}

interface ProcessedVideoDetails {
  pathOrUrl: string;
  sourceType: 'supabase' | 'external_url';
}

// --- NEW: Interface for the Supabase function response ---
interface ProcessVideoResponse {
  message: string;
  initialClips: InitialClipData[];
  suggestedVideoThemes: string[]; // <<< Added this
  processedVideoDetails: ProcessedVideoDetails;
}
// --- End Interfaces ---

// --- Helper Component for Score Visualization (Optional) ---
const ScoreVisualizer: React.FC<{ score: number }> = ({ score }) => {
  const stars = Math.round(score / 2);
  return (
    <span title={`Score: ${score}/10`}>
      {Array(5).fill(0).map((_, i) => (
        <span key={i} style={{ color: i < stars ? '#FFD700' : '#e0e0e0', fontSize: '1.2em' }}>
          ★
        </span>
      ))}
    </span>
  );
};
// --- End Helper Component ---


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
  const [processingClipId, setProcessingClipId] = useState<string | null>(null);
  const [sortClipsBy, setSortClipsBy] = useState<'score' | 'time'>('score');

  const [apiStatus, setApiStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const [apiError, setApiError] = useState<string | null>(null);

  // --- NEW: State for suggested video themes ---
  const [suggestedVideoThemes, setSuggestedVideoThemes] = useState<string[]>([]);
  // --- End State Variables ---

  const addLog = (message: string) => {
    console.log(message);
    setLogs(prevLogs => [`${new Date().toLocaleTimeString()}: ${message}`, ...prevLogs].slice(0, 100));
  };

  // --- useEffect for API Health Check on Mount (no changes here) ---
  useEffect(() => {
    const checkApiHealth = async () => {
      addLog('Performing local API health check...');
      setApiStatus('pending');
      try {
        const response = await fetch(`${LOCAL_API_BASE_URL}/api/hello`);

        if (response.ok) {
          const data = await response.json();
          if (data.message && data.message === "Hello from local API!") {
            addLog('Local API health check successful. Backend service seems reachable.');
            setApiStatus('ok');
            setApiError(null);
          } else {
            const warnMsg = `Local API health check warning: ${LOCAL_API_BASE_URL}/api/hello responded OK but with unexpected data. Expected { message: "Hello from local API!" }, got: ${JSON.stringify(data)}`;
            addLog(warnMsg);
            setApiStatus('error');
            setApiError('Local API service responded with unexpected data structure or message content.');
          }
        } else {
          const statusMsg = `Local API health check failed: ${LOCAL_API_BASE_URL}/api/hello responded with status ${response.status}.`;
          addLog(statusMsg);
          let errorText = `Local API service responded with HTTP error ${response.status}.`;
          if (response.status === 404) {
            errorText = `Local API endpoint ${LOCAL_API_BASE_URL}/api/hello not found (404). Ensure the local server is running and the endpoint exists.`;
          } else {
            try {
                const text = await response.text();
                if (text.toLowerCase().includes("cannot get /api/hello")) {
                    errorText += " It seems the local server is running but the /api/hello route is not defined.";
                } else if (text.length < 250) { 
                    errorText += ` Server message: ${text}`;
                }
            } catch (_) { /* Ignore if text() fails */ }
          }
          setApiError(errorText);
          setApiStatus('error');
        }
      } catch (error: any) {
        console.error("Local API health check fetch error:", error);
        let errorMsg = error.message || `Failed to connect to local API at ${LOCAL_API_BASE_URL}/api/hello. Is the server running?`;
        if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
             errorMsg = `Network error: Could not connect to the local API server at ${LOCAL_API_BASE_URL}. Please ensure the Docker container or local server is running.`;
        } else if (error instanceof SyntaxError) { 
            errorMsg = `Error parsing response from ${LOCAL_API_BASE_URL}/api/hello as JSON: ${error.message}. The server might have returned non-JSON error text.`;
        }
        addLog(`Local API health check critical error: ${errorMsg}`);
        setApiStatus('error');
        setApiError(errorMsg);
      }
    };

    if (supabaseUrl && supabaseAnonKey) {
        checkApiHealth();
    } else {
        setApiStatus('error');
        const configErrorMsg = 'Supabase configuration missing; API health check skipped and app cannot fully operate.';
        setApiError(configErrorMsg);
        addLog(configErrorMsg);
    }
  }, []);
  // --- End useEffect for API Health Check ---

  const resetAnalysisStates = () => {
    setProcessedVideoDetails(null);
    setAnalysisComplete(false);
    setClips([]);
    setSuggestedVideoThemes([]); // <<< RESET THEMES
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const MAX_FILE_SIZE_MB = 950;
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        addLog(`Error: File size exceeds ${MAX_FILE_SIZE_MB}MB limit. Selected file is ${(file.size / (1024 * 1024)).toFixed(2)} MB`);
        alert(`File size exceeds ${MAX_FILE_SIZE_MB}MB limit. Please choose a smaller file.`);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setSelectedFile(file);
      resetAnalysisStates(); // <<< USE HELPER
      addLog(`File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    } else {
      setSelectedFile(null);
    }
  };

  const handleDownloadOriginal = () => {
    // ... (no changes here)
    if (apiStatus !== 'ok') {
        addLog('Cannot download: Local API service is not available. Please check connection status.');
        alert('Local backend service is currently unavailable. Please ensure it is running and try again.');
        return;
    }
    if (!processedVideoDetails) {
        addLog('Error: No processed video details available for download. Please analyze a video first.');
        return;
    }
    addLog('Initiating download of the original analyzed video via local service...');
    const { pathOrUrl, sourceType } = processedVideoDetails;
    const downloadApiUrl = `${LOCAL_API_BASE_URL}/api/download-video`;
    const params = new URLSearchParams({ sourceType: sourceType, identifier: pathOrUrl });
    const fullDownloadUrl = `${downloadApiUrl}?${params.toString()}`;
    addLog(`Requesting download from local service: ${fullDownloadUrl}`);
    window.open(fullDownloadUrl, '_blank');
  };

  const handleSubmit = async () => {
    // ... (apiStatus checks - no changes here)
    if (apiStatus === 'error') {
        addLog('Cannot process video: Local API service is not available. Please check the initial health check logs.');
        alert('The application cannot connect to its local backend service. Please ensure the server/container is running.');
        return;
    }
    if (apiStatus === 'pending') {
        addLog('Local API health check still in progress or failed. Please wait or check logs before submitting.');
        alert('API status is not ready. Please wait for the health check to complete or resolve issues.');
        return;
    }

    setProcessing(true);
    setLogs([]);
    resetAnalysisStates(); // <<< USE HELPER TO RESET ALL ANALYSIS RELATED STATES
    addLog('Starting video analysis flow...');
    let videoIdentifierForFunction: { type: 'url', value: string } | { type: 'storagePath', value: string };

    try {
      // ... (video input validation and Supabase upload logic - no changes here)
      if (inputType === 'url' && videoUrlInput) {
        if (!videoUrlInput.trim()) {
          addLog('Error: Video URL cannot be empty.');
          setProcessing(false); return;
        }
        addLog(`Analyzing Video URL: ${videoUrlInput}`);
        videoIdentifierForFunction = { type: 'url', value: videoUrlInput };
      } else if (inputType === 'upload' && selectedFile) {
        addLog(`Uploading file for analysis: ${selectedFile.name}`);
        const fileExt = selectedFile.name.split('.').pop()?.toLowerCase() || '';
        const baseFileName = selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.') > -1 ? selectedFile.name.lastIndexOf('.') : selectedFile.name.length);
        const sanitizedFileName = baseFileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const supabasePath = `uploads/${Date.now()}_${sanitizedFileName}${fileExt ? '.' + fileExt : ''}`;

        addLog(`Attempting Supabase upload to: ${supabasePath}`);
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('raw-videos')
          .upload(supabasePath, selectedFile, {
            cacheControl: '3600', 
            upsert: false, 
            contentType: selectedFile.type || 'application/octet-stream'
          });

        if (uploadError) {
          throw new Error(`Supabase upload failed: ${uploadError.message}`);
        }
        if (!uploadData?.path) {
          throw new Error(`Supabase upload failed: No path returned from storage.`);
        }
        addLog(`Supabase upload successful: ${uploadData.path}`);
        videoIdentifierForFunction = { type: 'storagePath', value: uploadData.path };
      } else {
        addLog('Error: No Video URL provided or no file selected for analysis.');
        setProcessing(false); return;
      }


      addLog(`Invoking 'process-video' Supabase Edge Function...`);
      const functionPayload = videoIdentifierForFunction.type === 'url'
        ? { videoUrl: videoIdentifierForFunction.value }
        : { uploadedVideoPath: videoIdentifierForFunction.value };
      addLog(`'process-video' payload: ${JSON.stringify(functionPayload)}`);

      // --- UPDATE: Use ProcessVideoResponse type for invoke ---
      const { data: processResponse, error: processError } = await supabase.functions.invoke<ProcessVideoResponse>(
        'process-video', // Ensure this matches your deployed function name
        { body: functionPayload }
      );

      if (processError) {
        addLog(`'process-video' function error: ${JSON.stringify(processError, null, 2)}`);
        let detailedErrorMessage = processError.message || 'Unknown error from Supabase Edge Function';
        // @ts-ignore
        if (processError.context?.body && typeof processError.context.body === 'string') {
          try {
            const errorBody = JSON.parse(processError.context.body);
            detailedErrorMessage += ` | Server Detail: ${errorBody.error_message || errorBody.error || JSON.stringify(errorBody)}`;
          } catch (e) { /* Ignore */ }
        // @ts-ignore
        } else if (processError.context?.status) {
          detailedErrorMessage += ` (Status: ${processError.context.status})`;
        }
        throw new Error(`'process-video' function call failed: ${detailedErrorMessage}`);
      }

      addLog(`'process-video' function response: ${JSON.stringify(processResponse, null, 2)}`);
      // --- UPDATE: Validate and use the new response structure ---
      if (!processResponse || !Array.isArray(processResponse.initialClips) || !processResponse.processedVideoDetails || !Array.isArray(processResponse.suggestedVideoThemes) ) {
        throw new Error("Invalid response from 'process-video'. Expected 'initialClips' (array), 'suggestedVideoThemes' (array), and 'processedVideoDetails'. Received: " + JSON.stringify(processResponse));
      }

      addLog("'process-video' function completed successfully. Received metadata.");
      const initialClipsData: InitialClipData[] = processResponse.initialClips;
      const newSuggestedThemes: string[] = processResponse.suggestedVideoThemes; // <<< GET THEMES

      const clipsWithStatus: Clip[] = initialClipsData.map((clip, index) => ({
        ...clip,
        id: `clip-${Date.now()}-${index}`,
        status: 'pending',
      }));

      setClips(clipsWithStatus);
      setSuggestedVideoThemes(newSuggestedThemes); // <<< SET THEMES
      setProcessedVideoDetails(processResponse.processedVideoDetails);
      setAnalysisComplete(true);
      addLog(`Analysis complete. Identified ${clipsWithStatus.length} clips. Suggested themes: ${newSuggestedThemes.join(', ') || 'None'}.`);
      addLog(`Video Source: ${processResponse.processedVideoDetails.sourceType}, Identifier: ${processResponse.processedVideoDetails.pathOrUrl}`);

    } catch (error: any) {
      addLog(`Error in main analysis flow: ${error.message}`);
      console.error("Full error object in handleSubmit:", error);
      setAnalysisComplete(false);
      setSuggestedVideoThemes([]); // <<< RESET THEMES ON ERROR
      setClips(prev => prev.map(c => (c.status === 'pending') ? { ...c, status: 'failed', error: "Main analysis process failed." } : c ));
    } finally {
      setProcessing(false);
      if (fileInputRef.current) { fileInputRef.current.value = ""; }
    }
  };

  const handleDownloadClip = async (clip: Clip) => {
    // ... (no changes here)
    if (!processedVideoDetails) {
        addLog('Error: Cannot download clip - original video details are missing.');
        return;
    }
    if (processingClipId) {
        addLog(`Error: Cannot download clip for "${clip.hookPhraseTitle || clip.description}" - another clip ("${clips.find(c=>c.id===processingClipId)?.hookPhraseTitle || clips.find(c=>c.id===processingClipId)?.description || 'Unknown'}") is already being processed.`);
        return;
    }

    setProcessingClipId(clip.id);
    setClips(prevClips => prevClips.map(c =>
        c.id === clip.id ? { ...c, status: 'clipping', error: undefined } : c
    ));
    addLog(`Clipping process started for: "${clip.hookPhraseTitle || clip.description}" (${clip.startTime}s-${clip.endTime}s)`);

    const { pathOrUrl, sourceType } = processedVideoDetails;
    const clipApiUrl = `${LOCAL_API_BASE_URL}/api/clip-video`;
    const params = new URLSearchParams({
        sourceType: sourceType,
        identifier: pathOrUrl,
        startTime: String(clip.startTime),
        endTime: String(clip.endTime)
    });
    const fullClipUrl = `${clipApiUrl}?${params.toString()}`;
    addLog(`Requesting clip from local service: ${fullClipUrl}`);

    try {
        const response = await fetch(fullClipUrl);

        setClips(prevClips => prevClips.map(c =>
            c.id === clip.id ? { ...c, status: 'downloading' } : c
        ));

        if (!response.ok) {
            let errorMsg = `Server responded with HTTP error ${response.status}`;
            try {
                const errData = await response.json(); 
                errorMsg = errData.error || errData.message || errorMsg;
            } catch (e) {
                try {
                    const errText = await response.text();
                    if(errText && errText.length < 300) errorMsg = errText; 
                } catch (_) { /* Ignore */ }
            }
            throw new Error(`Failed to process or download clip: ${errorMsg}`);
        }

        const filenameHeader = response.headers.get('x-clip-filename');
        const safeTitleForFilename = (clip.hookPhraseTitle || clip.description).replace(/[^\w\s.-]/g, '').replace(/\s+/g, '_').substring(0,30);
        const defaultFilename = `clip_${safeTitleForFilename}_${clip.startTime}-${clip.endTime}.mp4`;
        const filename = filenameHeader || defaultFilename;
        addLog(`Received clip data. Filename: ${filename}. Processing blob...`);

        const blob = await response.blob();
        if (blob.size === 0) {
            throw new Error('Received empty blob for the clip. Clipping might have failed silently on the server.');
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        addLog(`Clip download initiated successfully: ${filename}`);
        setClips(prevClips => prevClips.map(c =>
            c.id === clip.id ? { ...c, status: 'completed' } : c
        ));

    } catch (error: any) {
        console.error("Error during clip download:", error);
        addLog(`Error downloading clip ("${clip.hookPhraseTitle || clip.description}"): ${error.message}`);
        setClips(prevClips => prevClips.map(c =>
            c.id === clip.id ? { ...c, status: 'failed_clip', error: error.message } : c
        ));
    } finally {
        setProcessingClipId(null); 
    }
  };

  const sortedAndFilteredClips = [...clips].sort((a, b) => {
    if (sortClipsBy === 'score') {
      return b.viralPotentialScore - a.viralPotentialScore;
    }
    return a.startTime - b.startTime;
  });

  // --- Conditional Rendering for App States (no changes here) ---
  if (!supabaseUrl || !supabaseAnonKey) {
    return (<div className="App"><header className="App-header"><h1>Configuration Error</h1></header><main><p className="log-error" style={{ padding: '20px', backgroundColor: '#ffebee', border: '1px solid #e57373', borderRadius: '4px' }}>CRITICAL: Application cannot start due to missing Supabase configuration (VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY). Please check your <code>.env</code> file and restart the development server.</p></main></div>);
  }
  if (apiStatus === 'pending') {
    return (
      <div className="App">
        <header className="App-header"><h1>Minimal Video Clipping Tool</h1><p>Powered by Supabase & Gemini</p></header>
        <main>
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <h2>Connecting to Backend Services...</h2>
            <p>Please wait while we verify the connection to the local API service.</p>
            <div className="loader" style={{ width: '50px', height: '50px', border: '5px solid #f3f3f3', borderTop: '5px solid #3498db', borderRadius: '50%', margin: '20px auto', animation: 'spin 1s linear infinite' }}></div>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
          <div className="results-section card" style={{maxHeight: '150px', overflowY: 'auto'}}>
            <h2>Initial Connection Logs</h2>
            <div className="logs"> {logs.slice(-5).map((log, index) => ( <p key={index} className={log.toLowerCase().includes('error') ? 'log-error' : ''}>{log}</p> ))} </div>
          </div>
        </main>
      </div>
    );
  }
  if (apiStatus === 'error') {
    return (
      <div className="App">
        <header className="App-header"><h1>Application Error</h1> <p>Local Backend Connection Failed</p></header>
        <main>
          <div className="card error-card">
            <h2 className="log-error">Could Not Connect to Local API Service</h2>
            <p>The application cannot reach its local backend service (expected at <code>{LOCAL_API_BASE_URL}</code>).</p>
            <p><strong>Error Details:</strong> {apiError || "An unknown error occurred during the API health check."}</p>
            <p>This usually means the local server (e.g., the Docker container for video processing) is not running, not accessible, or has encountered an internal error.</p>
            <strong>Please check the following:</strong>
            <ul style={{textAlign: 'left', paddingLeft: '20px'}}>
                <li>Ensure the local backend server or Docker container (e.g., <code>youtube-dl-container</code>) is running.</li>
                <li>Check the terminal where you started the server/container for any error messages.</li>
                <li>Verify the API URL (<code>{LOCAL_API_BASE_URL}</code>) is correct and accessible from your browser (try opening <code>{LOCAL_API_BASE_URL}/api/hello</code> directly).</li>
                <li>If you recently changed <code>.env</code> files or server configurations, try restarting both the backend server and this frontend application.</li>
                <li>Check your browser's developer console (F12) for more detailed network error messages.</li>
            </ul>
          </div>
          <div className="results-section card" style={{maxHeight: '200px', overflowY: 'auto'}}>
            <h2>Detailed Error Logs</h2>
            <div className="logs"> {logs.map((log, index) => ( <p key={index} className={log.toLowerCase().includes('error') || log.toLowerCase().includes('failed') ? 'log-error' : ''}>{log}</p> ))} </div>
          </div>
        </main>
      </div>
    );
  }
  // --- End Conditional Rendering ---


  return (
    <div className="App">
      <header className="App-header">
        <h1>Viral Clip Finder 🚀</h1>
        <p>Powered by Supabase & Gemini (Local API: <span style={{color: apiStatus === 'ok' ? 'lightgreen' : (apiStatus === 'pending' ? 'orange': 'red'), fontWeight: 'bold'}}>{apiStatus.toUpperCase()}</span>)</p>
      </header>
      <main>
        <div className="input-section card">
          <h2>1. Provide Video</h2>
           <div className="input-type-selector">
             <label>
                <input type="radio" name="inputType" value="url" checked={inputType === 'url'} 
                       onChange={() => { setInputType('url'); resetAnalysisStates(); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} 
                       disabled={processing}/> Video URL
             </label>
             <label>
                <input type="radio" name="inputType" value="upload" checked={inputType === 'upload'} 
                       onChange={() => { setInputType('upload'); resetAnalysisStates(); setVideoUrlInput(''); }} 
                       disabled={processing}/> Upload File (Max 950MB)
             </label>
           </div>
           {inputType === 'url' && (
             <input type="text" placeholder="Enter YouTube or direct video URL (e.g., .mp4, .mov)" value={videoUrlInput} 
                    onChange={(e) => { setVideoUrlInput(e.target.value); resetAnalysisStates(); }} 
                    disabled={processing} className="video-input"/>
           )}
           {inputType === 'upload' && (
             <input type="file" accept="video/*,.mov,.mp4,.mpeg,.avi,.webm" onChange={handleFileChange} 
                    ref={fileInputRef} disabled={processing} className="video-input-file" />
           )}
          <button onClick={handleSubmit} disabled={processing || (inputType === 'url' && !videoUrlInput.trim()) || (inputType === 'upload' && !selectedFile) || apiStatus !== 'ok'} className="action-button">
            {processing ? 'Analyzing Video...' : (apiStatus !== 'ok' ? 'LOCAL API OFFLINE' : '✨ Find Viral Clips')}
          </button>
        </div>

        {analysisComplete && processedVideoDetails && !processing && apiStatus === 'ok' && (
            <div className="download-section card">
                <h2>2. Original Video & Suggested Themes</h2> {/* <-- MODIFIED HEADER */}
                <button onClick={handleDownloadOriginal} disabled={apiStatus !== 'ok'} className="action-button secondary">
                    {apiStatus !== 'ok' ? 'LOCAL API OFFLINE' : 'Download Original Video'}
                </button>
                <p className="video-details">Source: {processedVideoDetails.sourceType}, Identifier: {processedVideoDetails.pathOrUrl}</p>
                
                {/* --- NEW: Display Suggested Video Themes --- */}
                {suggestedVideoThemes.length > 0 && (
                  <div className="suggested-themes-section">
                    <h4>Overall Video Themes Suggested by AI:</h4>
                    <ul className="themes-list">
                      {suggestedVideoThemes.map((theme, index) => (
                        <li key={index} className="theme-item">{theme}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* --- END: Display Suggested Video Themes --- */}
            </div>
        )}

        <div className="results-section card">
          {/* Adjust heading numbers based on whether themes section is shown */}
          <h2>{analysisComplete && processedVideoDetails && !processing && apiStatus === 'ok' ? '3.' : '2.'} Processing Logs</h2>
          <div className="logs">{logs.length === 0 && !processing && <p>Submit a video to start analysis. Logs will appear here.</p>}{logs.map((log, index) => ( <p key={index} className={`log-message ${log.toLowerCase().includes('error') || log.toLowerCase().includes('failed') ? 'log-error' : (log.toLowerCase().includes('success') ? 'log-success' : '')}`}>{log}</p> ))}</div>
        </div>

        <div className="results-section card">
           {/* Adjust heading numbers based on whether themes section is shown */}
          <h2>{analysisComplete && processedVideoDetails && !processing && apiStatus === 'ok' ? '4.' : '3.'} Potential Clips Identified</h2>
          {clips.length > 0 && (
            <div className="clips-controls">
              <label htmlFor="sortClips">Sort by: </label>
              <select id="sortClips" value={sortClipsBy} onChange={(e) => setSortClipsBy(e.target.value as 'score' | 'time')} disabled={processingClipId !== null}>
                <option value="score">Viral Score (High to Low)</option>
                <option value="time">Timestamp (Earliest First)</option>
              </select>
            </div>
          )}
          {sortedAndFilteredClips.length > 0 && (
            <ul className="clips-list">
             {sortedAndFilteredClips.map((clip) => {
                 const isProcessingThis = processingClipId === clip.id;
                 return (
                   <li key={clip.id} className={`clip-item status-${clip.status}`}>
                     <div className="clip-header">
                       <h3 className="clip-title-from-hook">{clip.hookPhraseTitle || "Untitled Clip"}</h3>
                       <ScoreVisualizer score={clip.viralPotentialScore} />
                     </div>
                     <div className="clip-details">
                        <p><strong>Summary:</strong> {clip.description}</p>
                        <p><strong>Timestamps:</strong> {clip.startTime}s - {clip.endTime}s</p>
                        <p><strong>Full Transcription:</strong> <em style={{ whiteSpace: 'pre-wrap' }}>{clip.clipTranscription || "N/A"}</em></p>
                        <p><strong>Viral Characteristic:</strong> {clip.primaryViralCharacteristic}</p>
                        <p><strong>Reasoning:</strong> {clip.reasoningForScore}</p>
                     </div>
                     <div className="clip-actions">
                        <span className={`status-badge status-${clip.status}`}>{isProcessingThis ? `${clip.status}...` : clip.status.replace('_', ' ')}</span>
                        {clip.status === 'pending' && !isProcessingThis && !processingClipId && processedVideoDetails && apiStatus === 'ok' && (
                             <button
                                 onClick={() => handleDownloadClip(clip)}
                                 disabled={!!processingClipId}
                                 className="action-button clip-download-button"
                             >
                                 Download Clip
                             </button>
                         )}
                        {(isProcessingThis || (clip.status !== 'pending' && clip.status !== 'completed' && clip.status !== 'failed_clip')) && clip.status !== 'failed' && (
                             <button
                                disabled={true}
                                className="action-button clip-download-button disabled"
                             >
                               {isProcessingThis ? `${clip.status.charAt(0).toUpperCase() + clip.status.slice(1)}...` : 'Processing...'}
                             </button>
                         )}
                        {clip.error && <p className="error-message clip-error">Error: {clip.error}</p>}
                     </div>
                   </li>
                 );
             })}
           </ul>)}
          {/* ... (existing messages for no clips, errors etc.) ... */}
          {processing && logs.length > 0 && <p className="info-message">Analyzing video and identifying potential clips...</p>}
          {!processing && analysisComplete && clips.length === 0 && logs.length > 0 && <p className="info-message">Analysis finished, but no specific clips were identified by the AI. Try a different video or check AI model settings.</p>}
          {!processing && !analysisComplete && logs.length > 0 && logs.some(log => log.toLowerCase().includes('error')) && <p className="info-message error-message">Analysis failed. Please review the logs for details.</p>}
          {!processing && !analysisComplete && clips.length === 0 && logs.length === 0 && apiStatus === 'ok' && <p className="info-message">Ready to analyze a video. Select a URL or upload a file.</p>}
        </div>
      </main>
      <footer>
        <p>© {new Date().getFullYear()} Your Clipping App. All Rights Reserved.</p>
      </footer>
    </div>
  );
}
export default App;