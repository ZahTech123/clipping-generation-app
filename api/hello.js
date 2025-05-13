// your-project-root/api/hello.js
// NO IMPORTS AT ALL AT THE TOP

export default function handler(req, res) {
  try {
    // This log is CRITICAL for debugging Vercel function execution
    console.log("[HELLO_API_MINIMAL] Request to /api/hello received by Vercel Function. Sending JSON.");
    res.status(200).json({ message: "Hello from minimal API!" }); // Sends JSON
  } catch (e) {
    console.error("[HELLO_API_MINIMAL_ERROR] Crash in /api/hello:", e);
    res.status(500).json({ error: "API /hello crashed.", details: e.message }); // Sends JSON error
  }
}