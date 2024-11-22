require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const Replicate = require('replicate')
const https = require('https')
const fs = require('fs')
const cors = require('cors')
const app = express()
const httpPort = 3001 // For HTTP (optional redirect to HTTPS)
const httpsPort = 3000 // For HTTPS

// Middleware
app.use(
  cors({
    origin: [
      'http://localhost',
      'https://localhost',
      'https://sb1pus4tc-4fzn--5173--d3acb9e1.local-corp.webcontainer.io/',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)
app.use(bodyParser.json())

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

// POST endpoint
app.post('/train', async (req, res) => {
  try {
    const { options } = req.body

    // Trigger training on Replicate
    const training = await replicate.trainings.create(
      'ostris', // Owner
      'flux-dev-lora-trainer', // Model
      'e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497', // Version
      options
    )
    console.log('training', training)
    // Respond with training status
    res.status(200).json(training)
  } catch (error) {
    console.error('Error initiating training:', error.message)
    res
      .status(500)
      .json({ error: 'Failed to initiate training', details: error.message })
  }
})

// Redirect HTTP to HTTPS
const http = require('http')
http
  .createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` })
    res.end()
  })
  .listen(httpPort, () => {
    console.log(
      `HTTP Server is running on http://localhost:${httpPort} and redirecting to HTTPS`
    )
  })

// Load self-signed certificate
const sslOptions = {
  key: fs.readFileSync('/etc/ssl/selfsigned/selfsigned.key'), // Path to your self-signed key
  cert: fs.readFileSync('/etc/ssl/selfsigned/selfsigned.crt'), // Path to your self-signed cert
}

// Start the HTTPS server
https.createServer(sslOptions, app).listen(httpsPort, () => {
  console.log(`HTTPS Server is running on https://localhost:${httpsPort}`)
})
