require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const Replicate = require('replicate')
const cors = require('cors')
const app = express()
const port = 3000

// Middleware
app.use(cors())
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

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
