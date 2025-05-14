// File: clipping-generation-app/api/test.js

/**
 * Default Vercel Serverless Function handler for Node.js.
 * This function will respond to any HTTP method.
 *
 * @param {import('@vercel/node').VercelRequest} req - The incoming request object.
 * @param {import('@vercel/node').VercelResponse} res - The outgoing response object.
 */
export default function handler(req, res) {
    // Log to Vercel console that the function was hit
    console.log(`Vercel test function invoked with method: ${req.method}`);
  s
    // Send a successful JSON response
    res.status(200).json({
      message: "Vercel test function reporting for duty!",
      timestamp: new Date().toISOString(),
      receivedMethod: req.method // Optionally include the method it received
    });
  }