require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const Replicate = require('replicate')
const cors = require('cors')
const Stripe = require('stripe')
const admin = require('firebase-admin')
const http = require('http')
const usersSubscriptions = {}
const app = express()
const httpPort = 3001
const httpsPort = 3000
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET

app.use(cors())
app.use(bodyParser.json())
const webhookBaseURL =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : 'https://34.45.36.169'
const port = 3000
const serviceAccount = require('./serviceAccountKey.json')
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})
const db = admin.firestore()

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY environment variable')
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

app.post('/train', async (req, res) => {
  try {
    const { gender, options } = req.body

    if (!gender) {
      return res
        .status(400)
        .json({ error: 'Gender (e.g., "male" or "female") is required.' })
    }

    const training = await replicate.trainings.create(
      'ostris',
      'flux-dev-lora-trainer',
      'e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497',
      {
        ...options,
        webhook: `${webhookBaseURL}/training-status/${training.id}`,
        webhook_events_filter: ['completed', 'failed'],
      }
    )

    console.log('Training initiated:', training)

    await db.collection('training_models').doc(training.id).set({
      trainingId: training.id,
      gender,
      status: 'pending',
      version: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    res.status(200).json({
      message: 'Training initiated successfully.',
      trainingId: training.id,
    })
  } catch (error) {
    console.error('Error initiating training:', error.message)
    res
      .status(500)
      .json({ error: 'Failed to initiate training', details: error.message })
  }
})

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { userId, redirectURL } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' })
    }

    if (usersSubscriptions[userId] && usersSubscriptions[userId].active) {
      return res.status(200).json({
        status: 'active',
        message: 'User already has an active subscription',
      })
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: process.env.SUBSCRIPTION_CURRENCY || 'usd',
            product_data: {
              name: process.env.SUBSCRIPTION_NAME || 'Subscription',
              description:
                process.env.SUBSCRIPTION_DESCRIPTION || 'Subscription Plan',
            },
            unit_amount: parseInt(process.env.SUBSCRIPTION_PRICE || 3900, 10),
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.REACT_PUBLIC_BASE_URL}${redirectURL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.REACT_PUBLIC_BASE_URL}/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        userId, // Attach userId to metadata for webhook processing
      },
    })

    res.status(200).json({
      status: 'pending',
      sessionId: session.id,
      message: 'Subscription session created. Redirect to Stripe Checkout.',
    })
  } catch (error) {
    console.error('Error creating checkout session:', error.message)
    res.status(500).json({
      status: 'error',
      error: 'Failed to create checkout session',
      details: error.message,
    })
  }
})

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature']

  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object

    const userId = session.metadata.userId

    usersSubscriptions[userId] = {
      active: true,
      subscriptionId: session.subscription,
    }

    console.log(`Subscription for user ${userId} is now active.`)
  }

  res.status(200).send('Webhook received')
})

app.get('/verify-subscription', async (req, res) => {
  try {
    const { session_id, userId } = req.query

    if (!session_id || !userId) {
      return res.status(400).json({ error: 'Missing session_id or userId' })
    }

    const session = await stripe.checkout.sessions.retrieve(session_id)

    if (session.payment_status === 'paid') {
      usersSubscriptions[userId] = {
        active: true,
        subscriptionId: session.subscription,
      }

      return res.status(200).json({ message: 'Subscription verified' })
    } else {
      return res.status(400).json({ error: 'Subscription not paid' })
    }
  } catch (error) {
    console.error('Error verifying subscription:', error.message)
    res.status(500).json({
      error: 'Failed to verify subscription',
      details: error.message,
    })
  }
})

app.post('/training-status/:trainingId', async (req, res) => {
  try {
    const { trainingId } = req.params
    const { status, version } = req.body

    console.log(`Training status for training ID ${trainingId}:`, status)

    const updateData = {
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    if (status === 'succeeded') {
      updateData.version = version
    }

    await db.collection('training_models').doc(trainingId).update(updateData)
    console.log(
      `Training status updated in Firestore for training ID ${trainingId}.`
    )

    res.status(200).send('Webhook processed successfully.')
  } catch (error) {
    console.error('Error in training-status webhook:', error.message)
    res.status(500).send('Error processing webhook.')
  }
})

app.post('/generate/:trainingId', async (req, res) => {
  try {
    const { trainingId } = req.params

    const trainingDoc = await db
      .collection('training_models')
      .doc(trainingId)
      .get()

    if (!trainingDoc.exists) {
      return res
        .status(404)
        .json({ error: `No training model found for ID: ${trainingId}` })
    }

    const trainingData = trainingDoc.data()

    if (trainingData.status === 'pending') {
      return res
        .status(403)
        .json({ error: 'Model training is still in progress. Please wait.' })
    }

    if (trainingData.status === 'failed') {
      return res
        .status(403)
        .json({ error: 'Model training failed. Unable to generate images.' })
    }

    if (trainingData.status !== 'succeeded') {
      return res.status(403).json({
        error: `Model training is not completed. Status: ${trainingData.status}`,
      })
    }

    const gender = trainingData.gender
    const promptsDoc = await db.collection('image_prompts').doc(gender).get()

    if (!promptsDoc.exists) {
      return res
        .status(404)
        .json({ error: `No prompts found for gender: ${gender}` })
    }

    const prompts = promptsDoc.data()
    const generatedImages = {}

    for (const [key, prompt] of Object.entries(prompts)) {
      console.log(`Generating image for prompt: ${prompt}`)

      const output = await replicate.run('ostris/flux-dev-lora-trainer', {
        version: trainingData.version,
        input: { prompt },
      })

      generatedImages[key] = output
    }

    res.status(200).json({ generatedImages })
  } catch (error) {
    console.error('Error generating images:', error.message)
    res
      .status(500)
      .json({ error: 'Failed to generate images', details: error.message })
  }
})

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

const sslOptions = {
  key: fs.readFileSync('/etc/ssl/selfsigned/selfsigned.key'),
  cert: fs.readFileSync('/etc/ssl/selfsigned/selfsigned.crt'),
}

https.createServer(sslOptions, app).listen(httpsPort, () => {
  console.log(`HTTPS Server is running on https://localhost:${httpsPort}`)
})
