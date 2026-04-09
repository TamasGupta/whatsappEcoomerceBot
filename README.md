# WhatsApp Ecommerce Bot

A Node.js WhatsApp bot that behaves like a lightweight ecommerce app. Buyers can:

- browse a catalog
- search products
- view product details
- add items to a cart
- place orders through chat

This project is built for the WhatsApp Cloud API webhook flow. If you do not configure Meta credentials yet, outgoing messages are logged locally in mock mode so you can still test the conversation logic.

## Features

- interactive home menu with WhatsApp buttons
- category browsing with WhatsApp list menus
- product detail actions for add-to-cart and buy-now
- product catalog loaded from `data/products.json`
- keyword search across product name, category, description, and tags
- cart management with add/remove actions
- multi-step checkout for address and payment mode
- Postgres-backed sessions and orders when `DATABASE_URL` is configured
- webhook verification endpoint for Meta

## Project Structure

```text
.
├── data/products.json
├── src
│   ├── bot
│   │   ├── handlers.js
│   │   └── sessionStore.js
│   ├── services
│   │   ├── db.js
│   │   └── whatsapp.js
│   ├── store
│   │   ├── orders.js
│   │   └── products.js
│   ├── config.js
│   └── index.js
├── .env.example
├── package.json
└── render.yaml
```

## Customer Flow

- `Start` opens a home menu with `Browse`, `Search`, and `Cart`
- `Browse` opens a category list
- selecting a category opens a product list
- selecting a product shows product details plus `Add 1`, `Buy Now`, and `View Cart`
- checkout continues with address collection and payment buttons

## Text Commands Users Can Send

- `catalog`
- `search earphones`
- `view P2001`
- `add P2001 2`
- `cart`
- `remove P2001`
- `checkout`
- `help`

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Fill these values in `.env`:

- `VERIFY_TOKEN`: any secret string you will also enter in the Meta webhook config
- `WHATSAPP_TOKEN`: WhatsApp Cloud API permanent or temporary access token
- `WHATSAPP_PHONE_NUMBER_ID`: phone number ID from Meta
- `DATABASE_URL`: Postgres connection string if you want persistence outside local memory
- `CATALOG_CURRENCY`: for example `INR` or `USD`

4. Start the server:

   ```bash
   npm start
   ```

## Deploy To Render

This repo is ready for Render using [render.yaml](C:\Users\Asus\Desktop\whatBot\render.yaml).

1. Push this project to GitHub.
2. In Render, create a new Blueprint service from that repo.
3. Render will detect `render.yaml` and create:

- a web service named `whatsapp-ecommerce-bot`
- a Postgres database named `Motocommerce`

4. The bundled Postgres config matches your exported Render setup:

- database name: `motocommercedb`
- database user: `thomasgupta`
- region: `oregon`

5. Set these secret environment variables in Render:

- `VERIFY_TOKEN`
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

`DATABASE_URL` is wired automatically from the Render Postgres connection string by the blueprint.

6. After deployment, Render will give you a permanent URL like:

```text
https://your-app-name.onrender.com
```

Use this in Meta:

- callback URL: `https://your-app-name.onrender.com/webhook`
- verify token: same value as `VERIFY_TOKEN`

## Meta Webhook Configuration

For local development, expose your server with a tunnel such as ngrok or Cloudflare Tunnel, then configure:

- callback URL: `https://your-domain/webhook`
- verify token: same value as `VERIFY_TOKEN`

Subscribe to message webhooks for your WhatsApp app.

## Sample Conversation

```text
User: start
Bot: Hi Test, welcome to MotoCommerce.
Bot: [Browse] [Search] [Cart]

User: taps Browse
Bot: category list menu

User: taps Electronics
Bot: product list menu

User: taps Wireless Neckband Earphones
Bot: product details + Add 1 / Buy Now / View Cart

User: taps Buy Now
Bot: Please send your full delivery address.

User: 14 MG Road, Bengaluru
Bot: payment buttons for Cash on Delivery / UPI

User: taps UPI
Bot: Order placed successfully: ORD-0001
```

## Next Improvements

- integrate payments and order status updates
- add admin flows for managing products and stock
