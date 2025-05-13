// api/hello.js
// NO IMPORTS AT ALL AT THE TOP

export default function handler(req, res) {
  // The VERY FIRST line of executable code:
  try {
    console.log("[HELLO_API_MINIMAL] Function handler invoked."); // Critical log
    res.status(200).send("Hello from minimal API!");
  } catch (e) {
    console.error("[HELLO_API_MINIMAL_ERROR] Crash:", e);
    res.status(500).send("Minimal API crashed.");
  }
}