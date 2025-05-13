// api/hello.js
// NO IMPORTS AT ALL AT THE TOP

export default function handler(req, res) {
  // The VERY FIRST line of executable code:
  try {
    console.log("[HELLO_API_MINIMAL] Function handler invoked. Sending JSON response.");
    // Send a JSON response
    res.status(200).json({ message: "Hello from minimal API!" }); // <-- Changed to .json()
  } catch (e) {
    console.error("[HELLO_API_MINIMAL_ERROR] Crash:", e);
    // Send a JSON error response
    res.status(500).json({ error: "Minimal API crashed.", details: e.message }); // <-- Changed to .json()
  }
}