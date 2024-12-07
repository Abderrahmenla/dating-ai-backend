require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const Replicate = require('replicate')
const https = require('https')
const fs = require('fs')
const cors = require('cors')
const Stripe = require('stripe')

const app = express()
const httpPort = 3001
const httpsPort = 3000

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
      success_url: `${process.env.REACT_PUBLIC_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.REACT_PUBLIC_BASE_URL}/cancel`,
    })

    res.status(200).json({ sessionId: session.id })
  } catch (error) {
    console.error('Error creating checkout session:', error.message)
    res.status(500).json({
      error: 'Failed to create checkout session',
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
