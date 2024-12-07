require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const Replicate = require('replicate')
const https = require('https')
const fs = require('fs')
const cors = require('cors')
const Stripe = require('stripe')
const usersSubscriptions = {}
const app = express()
const httpPort = 3001
const httpsPort = 3000
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
app.use(cors())
app.use(bodyParser.json())

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
    const { options } = req.body
    console.log('hello')
    const training = await replicate.trainings.create(
      'ostris',
      'flux-dev-lora-trainer',
      'e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497',
      options
    )

    res.status(200).json(training)
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

const sslOptions = {
  key: fs.readFileSync('/etc/ssl/selfsigned/selfsigned.key'),
  cert: fs.readFileSync('/etc/ssl/selfsigned/selfsigned.crt'),
}

https.createServer(sslOptions, app).listen(httpsPort, () => {
  console.log(`HTTPS Server is running on https://localhost:${httpsPort}`)
})
