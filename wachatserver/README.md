# WachatServer

A WhatsApp automation server built with Express.js and whatsapp-web.js.

## Features

- WhatsApp Web API integration
- Auto-reply functionality
- REST API endpoints for sending messages
- QR code authentication

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/ramanandhaaja/wachatserver.git
   cd wachatserver
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm run dev
   ```

4. Scan the QR code that appears in the terminal with WhatsApp on your phone

## API Endpoints

- POST `/api/send-message`
  - Send a WhatsApp message
  - Body: `{ "message": "Your message here" }`

## Environment Variables

- `PORT` - Server port (default: 3007)
- `NODE_ENV` - Environment (development/production)

## License

MIT
