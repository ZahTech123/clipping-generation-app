// api/hello.js
export default function handler(req, res) {
  console.log("[HELLO_API] Request to /api/hello received!");
  res.status(200).json({ message: "Hello from the Vercel API!" });
}